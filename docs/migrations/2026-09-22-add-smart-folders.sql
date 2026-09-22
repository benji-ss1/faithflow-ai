-- ProPresenter parity — SMART FOLDERS (rule-based auto-populating libraries).
-- Additive + idempotent. Safe to run repeatedly.
--
-- ORDERING (required): APPLY THIS MIGRATION BEFORE THE APP CODE DEPLOYS.
-- The app reads libraries via Drizzle db.select(), which lists every schema
-- column (incl. the new kind/rules). If the columns are missing at query time
-- those reads error. Existing rows default to kind='manual' with empty rules,
-- which is byte-for-byte today's behaviour — so this migration alone changes
-- nothing until the new code ships.
--
-- ROLLBACK IS AT THE BOTTOM AND WAS WRITTEN FIRST.

-- 1. Folder kind. 'manual' = today's drag-and-drop bucket (the default, so
--    every existing library keeps working untouched). 'smart' = membership is
--    derived from `rules` at query time; nothing is ever written to
--    songs.library_id / media_assets.library_id for a smart folder.
ALTER TABLE libraries
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'manual';

-- Guard the domain at the DB level so a bad write can never create a third,
-- unhandled kind that the app would silently treat as manual.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'libraries_kind_check'
  ) THEN
    ALTER TABLE libraries
      ADD CONSTRAINT libraries_kind_check CHECK (kind IN ('manual', 'smart'));
  END IF;
END $$;

-- 2. The rule set, e.g.
--      {"match":"all","rules":[{"field":"title","op":"contains","value":"christmas"}]}
--    Empty object for a manual folder. Kept as jsonb (not a child table)
--    because rules are always read and written whole, never queried across.
ALTER TABLE libraries
  ADD COLUMN IF NOT EXISTS rules jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 3. A smart folder is evaluated on every library-filtered list query, so the
--    columns its rules can reference need to be cheap to scan per church.
--    These mirror the fields exposed by src/lib/smart-folders.ts.
CREATE INDEX IF NOT EXISTS idx_songs_church_created
  ON songs(church_id, created_at);
CREATE INDEX IF NOT EXISTS idx_media_assets_church_kind
  ON media_assets(church_id, kind);

-- 3b. SMART PLAYLISTS — the same idea applied to service plans. A smart
--     playlist owns no `service_items` rows; its contents are synthesised at
--     read time from `rules`, exactly like a smart folder's membership.
--     Existing plans default to 'manual', i.e. today's behaviour untouched.
ALTER TABLE service_plans
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'manual';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'service_plans_kind_check'
  ) THEN
    ALTER TABLE service_plans
      ADD CONSTRAINT service_plans_kind_check CHECK (kind IN ('manual', 'smart'));
  END IF;
END $$;

ALTER TABLE service_plans
  ADD COLUMN IF NOT EXISTS rules jsonb NOT NULL DEFAULT '{}'::jsonb;

-- service_items is read by (plan, order) on every operator load.
CREATE INDEX IF NOT EXISTS idx_service_items_plan_order
  ON service_items(service_plan_id, "order");

-- 4. RLS — owner-role model, consistent with the 2026-08-18 lockdown and with
--    the original libraries migration. No new table is created here, so this
--    is a no-op re-assert for clarity.
ALTER TABLE libraries ENABLE ROW LEVEL SECURITY;

-- rollback:
--   DROP INDEX IF EXISTS idx_service_items_plan_order;
--   ALTER TABLE service_plans DROP CONSTRAINT IF EXISTS service_plans_kind_check;
--   ALTER TABLE service_plans DROP COLUMN IF EXISTS rules;
--   ALTER TABLE service_plans DROP COLUMN IF EXISTS kind;
--   DROP INDEX IF EXISTS idx_media_assets_church_kind;
--   DROP INDEX IF EXISTS idx_songs_church_created;
--   ALTER TABLE libraries DROP CONSTRAINT IF EXISTS libraries_kind_check;
--   ALTER TABLE libraries DROP COLUMN IF EXISTS rules;
--   ALTER TABLE libraries DROP COLUMN IF EXISTS kind;
--   -- Dropping these restores the pre-smart-folder schema exactly. Any smart
--   -- folders become ordinary empty manual libraries (they own no membership
--   -- rows by design), so NO song or media row is affected by the rollback.
