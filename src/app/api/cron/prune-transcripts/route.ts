import { NextResponse } from "next/server";
import { pruneTranscripts } from "@/lib/server/transcript-retention";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * GET /api/cron/prune-transcripts
 *
 * Daily retention prune for `transcript_segments`. Until 2026-09-21 the prune
 * existed only as a standalone script that nothing ever invoked, so
 * `church_preferences.transcript_retention_days` — shown to churches in
 * Settings as a promise — was never enforced and the table grew without bound.
 *
 * Bounded + idempotent per run (see transcript-retention.ts), so a large first
 * backlog drains safely over successive nights instead of one long delete.
 *
 * DRY RUN BY DEFAULT: deletes nothing and reports what WOULD go until
 * PRUNE_TRANSCRIPTS_ENABLED=1 is set. Retention has never actually run, so the
 * first real execution acts on transcripts accumulated since day one — read the
 * dry-run numbers and confirm every church's retention setting first.
 *
 * Guarded by CRON_SECRET and fails CLOSED, matching backfill-sermons: this
 * endpoint DELETES data, so an open version of it would be a destructive
 * vector. If the secret isn't configured we refuse rather than run.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 401 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await pruneTranscripts();
    console.log(JSON.stringify({ event: result.dryRun ? "prune.dryrun" : "prune.done", ...result, perChurch: undefined }));
    // `capped: true` means at least one church still has a backlog — the next
    // nightly run continues it. Surfaced so a cron watcher can see progress.
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cron/prune-transcripts] failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
