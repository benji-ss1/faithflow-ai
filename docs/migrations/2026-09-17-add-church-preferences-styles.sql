-- Per-church styles (PR B, 2026-09-17): Scripture Style + per-content-type
-- default themes move from per-machine localStorage to church_preferences so
-- every computer in a church shares them (and they stop leaking across churches).
--
-- ADDITIVE + IDEMPOTENT. APPLY THIS MIGRATION BEFORE THE APP CODE DEPLOYS:
-- Drizzle `db.select()` on church_preferences lists every schema column
-- (operator, dashboard, settings, library pages), so the columns must exist
-- before the code that reads them ships (CLAUDE.md rule 0(d)).
--
-- ── ROLLBACK (written first; run only AFTER reverting the app code) ──────────
-- DO $$
-- BEGIN
--   IF EXISTS (SELECT 1 FROM pg_publication_tables
--              WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
--                AND tablename = 'church_preferences') THEN
--     ALTER PUBLICATION supabase_realtime DROP TABLE public.church_preferences;
--   END IF;
-- END $$;
-- ALTER TABLE church_preferences DROP CONSTRAINT IF EXISTS church_preferences_content_type_styles_object;
-- ALTER TABLE church_preferences DROP CONSTRAINT IF EXISTS church_preferences_scripture_style_object;
-- ALTER TABLE church_preferences DROP COLUMN IF EXISTS content_type_styles_updated_at;
-- ALTER TABLE church_preferences DROP COLUMN IF EXISTS scripture_style_updated_at;
-- ALTER TABLE church_preferences DROP COLUMN IF EXISTS scripture_style;
-- ALTER TABLE church_preferences DROP COLUMN IF EXISTS content_type_styles;
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE church_preferences ADD COLUMN IF NOT EXISTS content_type_styles jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE church_preferences ADD COLUMN IF NOT EXISTS scripture_style jsonb;
ALTER TABLE church_preferences ADD COLUMN IF NOT EXISTS scripture_style_updated_at timestamptz;
-- NULL = the church never set its content-type themes (lets a client tell
-- "never set" from "deliberately emptied", and gates the one-time migration).
ALTER TABLE church_preferences ADD COLUMN IF NOT EXISTS content_type_styles_updated_at timestamptz;

-- Shape guards. NOT VALID = no table scan / no lock-heavy validation of existing
-- rows (all existing rows get the '{}' default / NULL anyway). New writes are checked.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'church_preferences_content_type_styles_object') THEN
    ALTER TABLE church_preferences
      ADD CONSTRAINT church_preferences_content_type_styles_object
      CHECK (jsonb_typeof(content_type_styles) = 'object') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'church_preferences_scripture_style_object') THEN
    ALTER TABLE church_preferences
      ADD CONSTRAINT church_preferences_scripture_style_object
      CHECK (scripture_style IS NULL OR jsonb_typeof(scripture_style) = 'object') NOT VALID;
  END IF;
END $$;

-- Realtime fan-out (user-approved): other computers in the church pick up a
-- style change within a Realtime hop. Guarded so re-running is a no-op and a
-- database without the supabase_realtime publication is untouched.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                       AND tablename = 'church_preferences') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.church_preferences;
  END IF;
END $$;
