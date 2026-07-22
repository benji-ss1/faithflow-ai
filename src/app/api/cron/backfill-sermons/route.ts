import { NextResponse } from "next/server";
import { backfillPendingIngestion } from "@/lib/server/sermon-rag";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * GET /api/cron/backfill-sermons
 *
 * Daily server-side backfill for the sermon-search RAG index. Any service
 * plan that has transcript_segments but no sermon_chunks yet (historical
 * services, transcripts loaded for services that predate the feature, or a
 * live ingest that failed) gets chunked + embedded here. This runs on Vercel
 * where the embedding model actually loads — chunk+embed can't run in every
 * dev environment — so it's the reliable place to turn stored transcripts
 * into searchable chunks. Bounded per run (a few plans) and idempotent, so
 * the backlog drains safely over successive daily runs.
 *
 * Guarded by CRON_SECRET (Vercel Cron carries internal auth; the header check
 * additionally stops this being hit as an open endpoint that would force a
 * 90MB model load + embedding work on demand).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  // Fail CLOSED: unlike the trivial warm-embeddings ping, this cron forces a
  // ~90MB model load + up to 3×200 embeddings per hit, so an open endpoint is
  // a real CPU/cost-DoS vector (review 🟡). Require CRON_SECRET — if it isn't
  // configured, refuse rather than run. Safe: ingestion still happens via the
  // live-session after() hook and the admin backfill route; only the daily
  // drain pauses until the secret is set.
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 401 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await backfillPendingIngestion(3);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("backfill-sermons cron error:", e);
    return NextResponse.json({ ok: false, error: "backfill failed" }, { status: 500 });
  }
}
