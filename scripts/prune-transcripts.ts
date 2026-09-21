/**
 * Retention prune — manual/CLI entry point.
 *
 * The logic lives in `src/lib/server/transcript-retention.ts` so this script
 * and the daily Vercel cron (`/api/cron/prune-transcripts`) run EXACTLY the
 * same code. Before 2026-09-21 this script was the only implementation and
 * nothing ever invoked it, so retention was never actually enforced.
 *
 * Run: npx tsx scripts/prune-transcripts.ts
 * Exits non-zero if the prune failed for any church, so a watcher can alert.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { pruneTranscripts } from "../src/lib/server/transcript-retention";

async function main() {
  const result = await pruneTranscripts();
  for (const c of result.perChurch) {
    console.log(JSON.stringify({
      event: c.error ? "prune.church.error" : "prune.church.ok",
      churchId: c.churchId, days: c.days, deleted: c.deleted, ...(c.error ? { error: c.error } : {}),
    }));
  }
  console.log(JSON.stringify({
    event: "prune.done",
    churches: result.churches, totalDeleted: result.totalDeleted,
    errors: result.errors, capped: result.capped, elapsedMs: result.elapsedMs,
  }));
  if (result.capped) {
    console.log("[prune] per-church cap hit — a backlog remains; run again (or let the nightly cron continue).");
  }
  if (result.errors > 0) process.exit(1);
}

main().catch((e) => {
  console.error("[prune] fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
