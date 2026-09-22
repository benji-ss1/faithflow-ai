-- Scale hardening for the 20+ concurrent-church target (2026-09-21).
--
-- transcript_segments is the fastest-growing table in the schema: the Fly audio
-- bridge writes one row per finalized utterance, for EVERY church, continuously
-- through every service. It had NO index at all. detected_references carries an
-- ON DELETE CASCADE FK back to it that was also unindexed.
--
-- Consequences before this migration:
--   * every sermon-summary JOIN and per-plan transcript read was a seq scan
--   * the retention prune's DELETE was O(deleted x table): removing one
--     transcript_segments row made Postgres seq-scan ALL of detected_references
--     to find its cascade children
-- Both get monotonically worse every week the tables grow.
--
-- ADDITIVE + IDEMPOTENT. Safe to apply BEFORE the app code deploys (an index is
-- invisible to the app). Apply it FIRST so the prune cron's first real run is
-- not a full scan.
--
-- CONCURRENTLY: transcript_segments is on the live write path during services.
-- A plain CREATE INDEX takes an ACCESS EXCLUSIVE lock and would block every
-- insert for the duration -- i.e. stall AI detection for every church mid-service.
-- CONCURRENTLY trades a slower build for not blocking writes.
--
-- !! Run these statements ONE AT A TIME, NOT inside a transaction block.
-- !! CREATE INDEX CONCURRENTLY cannot run in a transaction. In the Supabase SQL
-- !! editor run each line as its own query. If one fails it can leave an INVALID
-- !! index behind -- check with the verification query at the bottom and DROP it
-- !! before retrying.
--
-- ── ROLLBACK (written first; safe at any time, these are pure read accelerators)
-- DROP INDEX CONCURRENTLY IF EXISTS idx_transcript_segments_plan_ts;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_detected_references_segment;

-- (service_plan_id, ts) serves BOTH the per-plan transcript reads and the
-- retention prune's "this plan, older than N days" range scan from one index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transcript_segments_plan_ts
  ON public.transcript_segments (service_plan_id, ts);

-- Makes the ON DELETE CASCADE from transcript_segments an index lookup instead
-- of a full scan per deleted parent row.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_detected_references_segment
  ON public.detected_references (transcript_segment_id);

-- ── VERIFY (run after; both should be valid = true) ─────────────────────────
-- SELECT i.indexrelid::regclass AS index, i.indisvalid AS valid
-- FROM pg_index i
-- WHERE i.indexrelid::regclass::text IN
--   ('idx_transcript_segments_plan_ts', 'idx_detected_references_segment');
