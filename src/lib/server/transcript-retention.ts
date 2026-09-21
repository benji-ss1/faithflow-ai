/**
 * Transcript retention prune (server-side, 2026-09-21).
 *
 * `transcript_segments` grows by one row per finalized utterance, for every
 * church, through every service — the fastest-growing table in the schema.
 * A prune script has existed for a while (`scripts/prune-transcripts.ts`) but
 * it was NEVER wired to anything: no API route, no cron, no GitHub Action. So
 * `church_preferences.transcript_retention_days` — which the Settings UI shows
 * churches as a promise — was cosmetic, and nothing was ever deleted in
 * production.
 *
 * This is that script's logic, extracted so BOTH the manual script and a daily
 * Vercel cron run exactly the same code.
 *
 * BOUNDED: unlike the script, each run deletes at most `maxRowsPerChurch` rows
 * per church so a first run against a large backlog cannot exceed the route's
 * maxDuration or hold a long transaction on the live write path. The job is
 * idempotent, so the backlog drains over successive nightly runs.
 *
 * CASCADE: `detected_references.transcript_segment_id` is ON DELETE CASCADE.
 * Until the 2026-09-21 index migration that cascade was a full table scan per
 * deleted parent row — apply `docs/migrations/2026-09-21-scale-indexes-transcripts.sql`
 * BEFORE relying on this, or the first runs will be very slow.
 *
 * Sermon summaries and sermon chunks are independent (they hold their own text)
 * and are never touched here.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db/client";

export type PruneChurchResult = { churchId: string; days: number; deleted: number; error?: string };
export type PruneSummary = {
  /** True when nothing was actually deleted — the counts are what WOULD go. */
  dryRun: boolean;
  churches: number;
  totalDeleted: number;
  errors: number;
  capped: boolean;
  elapsedMs: number;
  perChurch: PruneChurchResult[];
};

/** Default per-church cap per run. Generous enough to drain a normal week,
 *  small enough that a first run on a large backlog stays well inside the
 *  route's 300s budget. */
export const DEFAULT_MAX_ROWS_PER_CHURCH = 20_000;

/**
 * DRY RUN BY DEFAULT.
 *
 * Retention has never run in production, so the very first real execution would
 * act on transcripts accumulated since day one — against a per-church setting
 * nobody has ever seen enforced. Deleting those is irreversible, so the default
 * is to COUNT what would go and delete nothing. Read the numbers, confirm each
 * church's `transcript_retention_days` is what you actually intend, then set
 * `PRUNE_TRANSCRIPTS_ENABLED=1` to arm it.
 */
export function pruneIsArmed(): boolean {
  return process.env.PRUNE_TRANSCRIPTS_ENABLED === "1";
}

export async function pruneTranscripts(opts?: { maxRowsPerChurch?: number; dryRun?: boolean }): Promise<PruneSummary> {
  const maxRows = Math.max(1, Math.min(200_000, opts?.maxRowsPerChurch ?? DEFAULT_MAX_ROWS_PER_CHURCH));
  const dryRun = opts?.dryRun ?? !pruneIsArmed();
  const db = getDb();
  const started = Date.now();

  const churches = (await db.execute(sql`
    SELECT cp.church_id, cp.transcript_retention_days AS days
    FROM church_preferences cp
    WHERE cp.transcript_retention_days > 0
  `)).rows as { church_id: string; days: number }[];

  const perChurch: PruneChurchResult[] = [];
  let totalDeleted = 0;
  let errors = 0;
  let capped = false;

  for (const c of churches) {
    // Church-scoped by construction: the id subquery joins service_plans and
    // filters on this church's id, so a prune can never touch another tenant's
    // transcripts (CLAUDE.md rule 5).
    try {
      // Identical predicate in both modes, so the dry-run count is exactly what
      // the armed run would remove — not an estimate from a different query.
      const res = dryRun
        ? await db.execute(sql`
            SELECT COUNT(*)::int AS count FROM (
              SELECT ts.id
              FROM transcript_segments ts
              JOIN service_plans sp ON sp.id = ts.service_plan_id
              WHERE sp.church_id = ${c.church_id}
                AND ts.ts < NOW() - (${c.days} || ' days')::interval
              LIMIT ${maxRows}
            ) AS would_delete
          `)
        : await db.execute(sql`
            DELETE FROM transcript_segments
            WHERE id IN (
              SELECT ts.id
              FROM transcript_segments ts
              JOIN service_plans sp ON sp.id = ts.service_plan_id
              WHERE sp.church_id = ${c.church_id}
                AND ts.ts < NOW() - (${c.days} || ' days')::interval
              LIMIT ${maxRows}
            )
          `);
      const deleted = dryRun
        ? ((res.rows?.[0] as { count?: number } | undefined)?.count ?? 0)
        : ((res as unknown as { rowCount?: number }).rowCount || 0);
      if (deleted >= maxRows) capped = true;
      totalDeleted += deleted;
      perChurch.push({ churchId: c.church_id, days: c.days, deleted });
    } catch (e) {
      errors += 1;
      const msg = e instanceof Error ? e.message : String(e);
      perChurch.push({ churchId: c.church_id, days: c.days, deleted: 0, error: msg });
      // One church's failure must not abandon the rest.
      console.error(JSON.stringify({ event: "prune.church.error", churchId: c.church_id, error: msg }));
    }
  }

  return { dryRun, churches: churches.length, totalDeleted, errors, capped, elapsedMs: Date.now() - started, perChurch };
}
