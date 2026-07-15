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
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { apiUser } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { audioSessions, servicePlans } from "@/lib/db/schema";
import { createLimiter } from "@/lib/rate-limit";

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
  await db.insert(audioSessions).values({
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
  });

  return NextResponse.json({ ok: true });
}
