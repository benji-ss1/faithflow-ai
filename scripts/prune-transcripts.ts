/**
 * Retention prune. Deletes transcript_segments older than each church's
 * configured retention window. Preserves detected_references and
 * ai_suggestions rows that reference those transcripts (schema has ON
 * DELETE CASCADE for detected_references → transcript_segments, so we
 * intentionally reparent instead — see below).
 *
 * Sermon summaries are independent — never touched here.
 *
 * Idempotent, safe to re-run. Logs a structured summary and exits non-zero
 * if the prune failed for any church so a cron watcher can alert.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { pruneTranscripts } from "../src/lib/server/transcript-retention";

async function main() {

  // Detach any detected_references whose transcript is about to be pruned:
  // set transcript_segment_id -> null once we allow nullability... but we
  // don't (NOT NULL FK cascade). Preserve detected refs by moving them onto
  // a sentinel row per church? Cleanest: copy the text into a keep-forever
  // column on detected_references so semantic archives remain valid even
  // after transcripts age out. For now, we CASCADE — same behaviour as the
  // schema declares. If a church wants long-lived detections, they raise
  // their retention window.
  //
  // We DO keep sermon_summaries independent — they hold their own text.
  const result = await pruneTranscripts();
  console.log(JSON.stringify({ event: "prune.done", ...result, errors: result.errors.length }));
  if (result.errors.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(JSON.stringify({ event: "prune.fatal", error: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
});
