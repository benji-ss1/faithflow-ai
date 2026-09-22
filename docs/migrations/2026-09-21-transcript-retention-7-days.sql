-- Transcript retention: 90 days -> 7 (owner directive 2026-09-21).
--
-- Raw transcript text is a short-lived working artefact. A church that wants
-- its sermon text has a week to take it. What they actually keep long-term --
-- sermon_summaries and sermon_chunks (the searchable sermon index) -- live in
-- SEPARATE tables that hold their own text and are NEVER touched by the prune,
-- so shortening this does not cost anyone sermon search.
--
-- READ THIS BEFORE APPLYING:
-- Retention has NEVER actually run in production (the prune script existed but
-- nothing invoked it until 2026-09-21). So every transcript since day one is
-- still present. Dropping 90 -> 7 widens what the first armed prune removes
-- from "older than 90 days" to "older than 7 days".
--
-- The prune is DRY RUN BY DEFAULT (PRUNE_TRANSCRIPTS_ENABLED is not set), so
-- applying this migration deletes NOTHING on its own. Correct order:
--   1. apply the index migration (2026-09-21-scale-indexes-transcripts.sql)
--   2. apply this
--   3. let the nightly cron report the dry-run counts, READ THEM
--   4. only then set PRUNE_TRANSCRIPTS_ENABLED=1
--
-- ADDITIVE + IDEMPOTENT. Safe to run with the app live: it changes a number,
-- nothing reads it except the prune.
--
-- ── ROLLBACK (written first) ────────────────────────────────────────────────
-- ALTER TABLE church_preferences ALTER COLUMN transcript_retention_days SET DEFAULT 90;
-- UPDATE church_preferences SET transcript_retention_days = 90 WHERE transcript_retention_days = 7;
--   (Note: rollback restores the SETTING, not deleted rows. Once the prune has
--    been armed and has run, the transcripts it removed are gone for good.)

-- New churches.
ALTER TABLE church_preferences
  ALTER COLUMN transcript_retention_days SET DEFAULT 7;

-- Existing churches still carrying the old 90-day default. A church that has
-- DELIBERATELY chosen some other number keeps it -- we only move the ones that
-- never made a choice.
UPDATE church_preferences
   SET transcript_retention_days = 7
 WHERE transcript_retention_days = 90;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- SELECT transcript_retention_days, COUNT(*)
--   FROM church_preferences GROUP BY 1 ORDER BY 1;
