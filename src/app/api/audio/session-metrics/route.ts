/**
 * Task 14 — audio session metrics ingestion.
 *
 * POSTed by the client on WS finalize (see useAudioStream.flushSessionMetrics).
 * Auth-gated via apiUser(); church-scoped (churchId is authoritative from the
 * session, NOT the request body). Rate-limited to 60/min per user to prevent
 * a stuck client from spamming the DB.
 *
 * Body shape:
 *   { planId, durationSec, reconnects, avgConfidence, wordsHigh, wordsLow, startedAt, endedAt }
 */
import { NextResponse, after } from "next/server";
import { and, eq } from "drizzle-orm";
import { apiUser } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { audioSessions, churchLearnedKeyterms, servicePlans } from "@/lib/db/schema";
import { createLimiter } from "@/lib/rate-limit";
import { ingestServiceTranscript } from "@/lib/server/sermon-rag";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";

const check = createLimiter("api-audio-session-metrics", 60, 60_000);

function toInt(v: unknown, def = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : def;
}
function toNum(v: unknown, def = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : def;
}
function toDate(v: unknown): Date | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n);
  return isNaN(d.getTime()) ? null : d;
}

export async function POST(req: Request) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const ok = await check(user.id);
  if (!ok) {
    return NextResponse.json({ error: "Too many requests" }, {
      status: 429,
      headers: { "Retry-After": "60" },
    });
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const planId = typeof body.planId === "string" ? body.planId : "";
  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 });

  const db = getDb();
  // Verify plan belongs to the user's church — church_id must never come
  // from the request body.
  const [plan] = await db
    .select({ id: servicePlans.id })
    .from(servicePlans)
    .where(and(eq(servicePlans.id, planId), eq(servicePlans.churchId, user.churchId)))
    .limit(1);
  if (!plan) return NextResponse.json({ error: "plan not found" }, { status: 403 });

  const startedAt = toDate(body.startedAt);
  const endedAt = toDate(body.endedAt);
  if (!startedAt || !endedAt) return NextResponse.json({ error: "invalid timestamps" }, { status: 400 });
  if (endedAt.getTime() < startedAt.getTime()) {
    return NextResponse.json({ error: "endedAt before startedAt" }, { status: 400 });
  }

  const avgConfidence = toNum(body.avgConfidence, 0);
  // R3: dedupe by client-supplied sessionId. StrictMode + keepalive can retry
  // the same request; onConflictDoNothing keeps the table honest.
  const sessionId = typeof body.sessionId === "string" && body.sessionId.length > 0 && body.sessionId.length <= 64
    ? body.sessionId
    : null;
  await db.insert(audioSessions).values({
    sessionId,
    churchId: user.churchId,
    userId: user.id,
    planId,
    durationSec: toInt(body.durationSec),
    reconnects: toInt(body.reconnects),
    avgConfidence: avgConfidence.toFixed(2),
    wordsHigh: toInt(body.wordsHigh),
    wordsLow: toInt(body.wordsLow),
    startedAt,
    endedAt,
  }).onConflictDoNothing({ target: audioSessions.sessionId });

  // Roadmap #4 — upsert low-confidence tokens into
  // church_learned_keyterms and auto-promote once they cross the
  // threshold. Church-scoped from the authenticated session (never body).
  // Bounded per POST (40 max, already trimmed client-side); each row's
  // occurrences/avgConfidence gets a rolling update via SQL. Promotion
  // rule: occurrences >= MIN_OCCURRENCES_TO_PROMOTE flips active=true
  // and stamps promoted_at. Learned terms feed loadKeyterms() on the
  // NEXT Deepgram connection — no live rewiring mid-service (safer).
  const MIN_OCCURRENCES_TO_PROMOTE = 3;
  const rawTokens = Array.isArray(body.lowConfTokens) ? body.lowConfTokens : [];
  const cleanTokens: { display: string; count: number; avgConf: number }[] = [];
  for (const t of rawTokens.slice(0, 40)) {
    if (!t || typeof t !== "object") continue;
    const rec = t as Record<string, unknown>;
    const display = typeof rec.display === "string" ? rec.display.trim() : "";
    if (display.length < 4 || display.length > 24) continue;
    // Extra server-side sanitize: keep alnum + spaces + apostrophe/hyphen only.
    if (!/^[\p{L}\p{N}][\p{L}\p{N}'\- ]*$/u.test(display)) continue;
    const count = toInt(rec.count);
    if (count < 2) continue;
    const avgConf = toNum(rec.avgConf, 0);
    cleanTokens.push({ display, count, avgConf });
  }
  if (cleanTokens.length > 0) {
    for (const t of cleanTokens) {
      const normalized = t.display.toLowerCase();
      await db.insert(churchLearnedKeyterms).values({
        churchId: user.churchId,
        normalizedTerm: normalized,
        displayTerm: t.display,
        source: "learned",
        occurrences: t.count,
        avgConfidence: t.avgConf.toFixed(2),
        active: t.count >= MIN_OCCURRENCES_TO_PROMOTE,
        promotedAt: t.count >= MIN_OCCURRENCES_TO_PROMOTE ? new Date() : null,
      }).onConflictDoUpdate({
        target: [churchLearnedKeyterms.churchId, churchLearnedKeyterms.normalizedTerm],
        set: {
          occurrences: sql`${churchLearnedKeyterms.occurrences} + ${t.count}`,
          // Rolling-ish avg: bias toward the more-observed side.
          avgConfidence: sql`ROUND(((${churchLearnedKeyterms.avgConfidence}::numeric * ${churchLearnedKeyterms.occurrences}) + (${t.avgConf} * ${t.count})) / (${churchLearnedKeyterms.occurrences} + ${t.count}), 2)`,
          lastSeenAt: new Date(),
          // Promote when running total crosses the threshold. active is
          // sticky true once flipped — operator can flip false manually.
          active: sql`${churchLearnedKeyterms.active} OR (${churchLearnedKeyterms.occurrences} + ${t.count}) >= ${MIN_OCCURRENCES_TO_PROMOTE}`,
          promotedAt: sql`CASE WHEN ${churchLearnedKeyterms.promotedAt} IS NULL AND (${churchLearnedKeyterms.occurrences} + ${t.count}) >= ${MIN_OCCURRENCES_TO_PROMOTE} THEN now() ELSE ${churchLearnedKeyterms.promotedAt} END`,
        },
      });
    }
  }

  // Chunk + embed this service's transcript for RAG search once its
  // AI-listening session ends. Scheduled via after() rather than fired
  // fire-and-forget: a serverless instance is free to terminate the moment
  // the response is sent, which would silently kill an un-awaited promise
  // mid-embedding. after() keeps this instance alive until the work finishes
  // without making the client wait for it. ingestServiceTranscript() is
  // idempotent per servicePlanId, so repeat calls across reconnects within
  // the same service are safe no-ops.
  after(() => ingestServiceTranscript(user.churchId, planId).catch((e) => {
    console.error("[sermon-rag] ingestion failed:", e instanceof Error ? e.message : e);
  }));

  return NextResponse.json({ ok: true });
}
