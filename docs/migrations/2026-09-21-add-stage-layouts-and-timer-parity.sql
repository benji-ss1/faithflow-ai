-- Stage Layouts + ProPresenter timer parity (2026-09-21, user-directed).
--
-- Two things:
--   1. timer_definitions gains the ProPresenter timer fields it was missing
--      (Allows Overrun, Countdown-to-Time AM/PM/24h period, Elapsed start/end,
--      overrun colour).
--   2. New tables stage_layouts + stage_screens back the ProPresenter-style
--      Stage Layout editor (Screens > Edit Layouts).
--
-- ADDITIVE + IDEMPOTENT. APPLY THIS MIGRATION BEFORE THE APP CODE DEPLOYS:
-- Drizzle `db.select()` lists every schema column, so the columns must exist
-- before the code that reads them ships (CLAUDE.md rule 0(d)).
--
-- DELIBERATELY NOT DONE: no new VALUE is added to the existing `timer_type`
-- enum. ProPresenter's "Countdown to Time" is already the shipped
-- `countdown_to` value (it stores a wall-clock target); it only lacked an
-- AM/PM/24h period. Adding a value to an existing Postgres enum is a ONE-WAY
-- door (there is no clean DROP VALUE). Creating a NEW enum type is reversible.
-- So this migration has a genuine rollback — see below.
--
-- ── ROLLBACK (written first; run only AFTER reverting the app code) ─────────
-- DROP TABLE IF EXISTS stage_screens;
-- DROP TABLE IF EXISTS stage_layouts;
-- ALTER TABLE timer_definitions DROP COLUMN IF EXISTS overrun_color;
-- ALTER TABLE timer_definitions DROP COLUMN IF EXISTS elapsed_end_sec;
-- ALTER TABLE timer_definitions DROP COLUMN IF EXISTS elapsed_start_sec;
-- ALTER TABLE timer_definitions DROP COLUMN IF EXISTS period;
-- ALTER TABLE timer_definitions DROP COLUMN IF EXISTS allows_overrun;
-- DROP TYPE IF EXISTS timer_period;   -- safe: nothing else references it
-- ───────────────────────────────────────────────────────────────────────────

-- 1. Period enum for "Countdown to Time". New TYPE (reversible), not a new
--    value on timer_type (irreversible).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'timer_period') THEN
    CREATE TYPE timer_period AS ENUM ('am', 'pm', '24_hour');
  END IF;
END $$;

-- 2. ProPresenter timer fields.
--    allows_overrun DEFAULTS TRUE, deliberately: PresentFlow timers have ALWAYS
--    overrun, so defaulting to ProPresenter's own `false` would silently change
--    the behaviour of every existing timer on deploy. Existing rows keep
--    overrunning; new timers can opt out. (CLAUDE.md rule 0.)
ALTER TABLE timer_definitions ADD COLUMN IF NOT EXISTS allows_overrun boolean NOT NULL DEFAULT true;
-- NULL period = read target_clock as 24h, exactly how every existing row behaves.
ALTER TABLE timer_definitions ADD COLUMN IF NOT EXISTS period timer_period;
ALTER TABLE timer_definitions ADD COLUMN IF NOT EXISTS elapsed_start_sec integer;
-- NULL end = "unlimited end time" (ProPresenter's own wording).
ALTER TABLE timer_definitions ADD COLUMN IF NOT EXISTS elapsed_end_sec integer;
ALTER TABLE timer_definitions ADD COLUMN IF NOT EXISTS overrun_color text;

-- Sanity bounds. NOT VALID = no full table scan; existing rows are all NULL
-- anyway, and new writes are checked.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'timer_definitions_elapsed_range') THEN
    ALTER TABLE timer_definitions
      ADD CONSTRAINT timer_definitions_elapsed_range
      CHECK (
        (elapsed_start_sec IS NULL OR (elapsed_start_sec >= 0 AND elapsed_start_sec <= 86400))
        AND (elapsed_end_sec IS NULL OR (elapsed_end_sec >= 0 AND elapsed_end_sec <= 86400))
      ) NOT VALID;
  END IF;
END $$;

-- 3. Stage layouts — named confidence-monitor designs (PP "Edit Layouts").
CREATE TABLE IF NOT EXISTS stage_layouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  name text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stage_layouts_church ON stage_layouts (church_id, sort_order);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stage_layouts_config_object') THEN
    ALTER TABLE stage_layouts
      ADD CONSTRAINT stage_layouts_config_object
      CHECK (jsonb_typeof(config) = 'object') NOT VALID;
  END IF;
END $$;

-- 4. Stage screens — one row per physical confidence monitor, each pointing at
--    its own layout, so several stage screens can show different layouts at
--    once (ProPresenter assigns a layout per stage screen independently).
--    layout_id is TEXT so a BUILT-IN layout id ("builtin-timer-only") can be
--    assigned without first materialising it as a row; hence no FK.
CREATE TABLE IF NOT EXISTS stage_screens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  name text NOT NULL,
  layout_id text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stage_screens_church ON stage_screens (church_id, sort_order);

-- NOTE: no rows are seeded. A church with no stage_screens row keeps the
-- EXISTING hardcoded /stage screen exactly as today — the rule-0 anchor. The
-- new editor only takes effect once an operator opts in by assigning a layout.
