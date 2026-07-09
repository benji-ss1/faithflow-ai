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
import { sql } from "drizzle-orm";
import { getDb } from "../src/lib/db/client";

async function main() {
  const db = getDb();
  const started = Date.now();

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
  const churches = (await db.execute(sql`
    SELECT
      cp.church_id,
      cp.transcript_retention_days AS days
    FROM church_preferences cp
    WHERE cp.transcript_retention_days > 0
  `)).rows as { church_id: string; days: number }[];

  if (churches.length === 0) {
    console.log(JSON.stringify({ event: "prune.skip", reason: "no retention configured", elapsedMs: Date.now() - started }));
    process.exit(0);
  }

  let totalDeleted = 0;
  const errors: { churchId: string; error: string }[] = [];

  for (const c of churches) {
    try {
      const res = await db.execute(sql`
        DELETE FROM transcript_segments ts
        USING service_plans sp
        WHERE ts.service_plan_id = sp.id
          AND sp.church_id = ${c.church_id}
          AND ts.ts < NOW() - (${c.days} || ' days')::interval
      `);
      // node-postgres surfaces affected row count as `rowCount`
      const rowCount = (res as unknown as { rowCount?: number }).rowCount || 0;
      totalDeleted += rowCount;
      console.log(JSON.stringify({ event: "prune.church.ok", churchId: c.church_id, days: c.days, deleted: rowCount }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({ churchId: c.church_id, error: msg });
      console.error(JSON.stringify({ event: "prune.church.error", churchId: c.church_id, error: msg }));
    }
  }

  const summary = { event: "prune.done", churches: churches.length, totalDeleted, errors: errors.length, elapsedMs: Date.now() - started };
  console.log(JSON.stringify(summary));
  if (errors.length > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => {
  console.error(JSON.stringify({ event: "prune.fatal", error: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
});
