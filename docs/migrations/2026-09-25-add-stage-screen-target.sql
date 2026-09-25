-- Stage screen TARGET — "Show on screen" (2026-09-25, user-directed).
--
-- A stage_screens row has until now ALWAYS meant a confidence monitor. This
-- adds the output it actually drives, so a layout can be put on the PROJECTOR
-- instead of only on a stage screen.
--
-- Values are EXACTLY the four TIMER_SCREEN_IDS (src/engine/timers/screens.ts):
--   main | stage | livestream | ndi
-- The same vocabulary as timer routing and SceneScreen, so the product has one
-- screen vocabulary rather than two. TEXT + CHECK rather than a new enum: a
-- CHECK is editable in one statement, a Postgres enum value is a one-way door.
--
-- DEFAULT 'stage' and NOT NULL, so every EXISTING row keeps its exact current
-- meaning. Combined with the wire rule (target is OMITTED when it is 'stage')
-- every existing church's OutputState stays byte-identical after this ships.
--
-- ADDITIVE + IDEMPOTENT. APPLY THIS MIGRATION BEFORE THE APP CODE DEPLOYS.
-- Two independent reasons, both real:
--   (a) Drizzle db.select() enumerates every column in schema.ts, so
--       listStageScreens() throws "column stage_screens.target does not exist"
--       the moment the code is ahead of the DB — and that runs on the operator
--       console, i.e. on Sunday.
--   (b) scripts/check-schema.mts derives the expected column set from
--       schema.ts and FAILS THE BUILD when the database is behind. If this is
--       not applied first the Vercel build fails and the deploy does not
--       happen. That is the designed outcome, not a bug — apply the SQL,
--       THEN push.
--
-- ── ROLLBACK (written first; run only AFTER reverting the app code) ─────────
-- ALTER TABLE stage_screens DROP CONSTRAINT IF EXISTS stage_screens_target_valid;
-- ALTER TABLE stage_screens DROP COLUMN IF EXISTS target;
-- (Reverting the code alone is safe and needs no SQL: an extra column with a
--  default is invisible to the previous build. Drop it only if genuinely
--  unwanted.)
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE stage_screens ADD COLUMN IF NOT EXISTS target text NOT NULL DEFAULT 'stage';

-- NOT VALID = no full-table scan. Every existing row is 'stage' by the default
-- above and trivially satisfies it; new writes are checked.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stage_screens_target_valid') THEN
    ALTER TABLE stage_screens
      ADD CONSTRAINT stage_screens_target_valid
      CHECK (target IN ('main', 'stage', 'livestream', 'ndi')) NOT VALID;
  END IF;
END $$;

-- NO backfill and NO seeded rows. A church with no stage_screens row keeps the
-- existing hardcoded /stage screen exactly as today — the rule-0 anchor.
