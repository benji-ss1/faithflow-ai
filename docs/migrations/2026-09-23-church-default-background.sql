-- Church defaults (2026-09-23, user-approved) — DEFAULT ANIMATED BACKGROUND.
-- Additive + idempotent. Safe to run repeatedly.
--
-- ============================================================================
-- ROLLBACK (written FIRST — run this to undo; nothing else depends on it):
--
--   ALTER TABLE church_preferences DROP COLUMN IF EXISTS default_background_id;
--
-- The app tolerates the column being ABSENT (before this migration or after
-- the rollback): the column is NOT on the main Drizzle `churchPreferences`
-- table object (whose db.select() lists every column on operate/operator/
-- settings/dashboard pages). It is read/written only with explicit raw SQL in
-- src/lib/server/church-defaults.ts, always inside a try/catch. A missing column therefore
-- means "no church default background" — it can NEVER make the operate page
-- fall back to KJV or fail to load.
-- ============================================================================
--
-- ORDERING: either order is safe. Apply before the code for the feature to be
-- usable; before then the "Default animated background" picker just won't save
-- (the action returns a clear error).
--
-- Value: a built-in background template id (e.g. 'gentleWaves', 'holyFire') or
-- NULL = no default. Validated in the app against BUILT_IN_BACKGROUNDS; custom
-- uploads are per-machine localStorage and are not eligible.

ALTER TABLE church_preferences
  ADD COLUMN IF NOT EXISTS default_background_id text NULL;
