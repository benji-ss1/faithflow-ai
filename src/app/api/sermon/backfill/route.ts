import { NextResponse, after } from "next/server";
import { apiRequireRole } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { servicePlans, transcriptSegments } from "@/lib/db/schema";
import { ingestServiceTranscript } from "@/lib/server/sermon-rag";
import { createLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";

const check = createLimiter("api-sermon-backfill", 10, 60_000);

/**
 * POST /api/sermon/backfill  { title, text, scheduledFor? }
 *
 * Admin-only path to load a PAST service's transcript into the sermon-search
 * RAG index — for services that predate live AI listening, or transcripts
 * captured elsewhere. Creates a service_plan (church-scoped, churchId from the
 * session — never the body) + one transcript_segment holding the text, then
 * schedules chunk+embed via after() so it runs server-side without blocking
 * the response. Idempotent-safe: ingestion skips a plan that already has
 * chunks, and the daily backfill cron will also pick up anything after()
 * didn't finish.
 *
 * Deliberately takes the transcript from the CALLER (their own church's
 * content) rather than being auto-populated from any external source.
 */
export async function POST(req: Request) {
  const user = await apiRequireRole("admin", "pastor");
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const ok = await check(user.id);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": "60" } });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const scheduledFor = typeof body.scheduledFor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.scheduledFor)
    ? body.scheduledFor
    : null;
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
  if (text.split(/\s+/).filter(Boolean).length < 40) {
    return NextResponse.json({ error: "transcript too short (need ~40+ words)" }, { status: 400 });
  }
  // Cap the accepted body so a single paste can't be abusively large; a very
  // long service transcript is well under this.
  if (text.length > 500_000) return NextResponse.json({ error: "transcript too large" }, { status: 413 });

  const db = getDb();
  const [plan] = await db.insert(servicePlans).values({
    churchId: user.churchId,
    title: `[Backfill] ${title}`,
    scheduledFor,
  }).returning({ id: servicePlans.id });

  await db.insert(transcriptSegments).values({ servicePlanId: plan.id, text });

  after(() => ingestServiceTranscript(user.churchId, plan.id).catch((e) => {
    console.error("[sermon-backfill] ingestion failed:", e instanceof Error ? e.message : e);
  }));

  return NextResponse.json({ ok: true, planId: plan.id, note: "Transcript stored; indexing runs in the background and is searchable shortly." });
}
