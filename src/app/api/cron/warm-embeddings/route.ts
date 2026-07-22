import { NextResponse } from "next/server";
import { embed } from "@/lib/embeddings";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/cron/warm-embeddings
 *
 * Part 3 (search latency): the local transformer model in
 * `src/lib/embeddings.ts` (~90MB, @xenova/transformers) reloads from scratch
 * on every cold Vercel serverless instance, so the FIRST semantic Bible
 * search after a cold start pays the full model-load cost before returning.
 * This is a keep-warm ping, not a new feature — it just calls `embed()` with
 * a trivial string on a schedule so at least one warm instance's in-process
 * singleton (`getEmbedder()`'s module-level `_extractor`) stays populated
 * across requests, lowering the odds a live-service search hits a cold
 * instance. Registered in vercel.json to run every 5 minutes.
 *
 * Optional CRON_SECRET guard: Vercel Cron invocations already carry
 * internal auth, but if CRON_SECRET is set we also check the standard
 * `Authorization: Bearer <secret>` header so this can't be hit as an open
 * public endpoint that force-loads a 90MB model on demand.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  try {
    await embed("warm");
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("warm-embeddings cron error:", e);
    return NextResponse.json({ ok: false, error: "warm failed" }, { status: 500 });
  }
}
