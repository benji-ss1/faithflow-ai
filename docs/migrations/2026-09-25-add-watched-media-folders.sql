-- Watched media folders (ProPresenter "Smart Playlist" parity).
-- Additive + idempotent. Safe to run repeatedly.
--
-- ORDERING (required): APPLY BEFORE THE APP CODE DEPLOYS.
-- Drizzle's db.select() enumerates every column in schema.ts, so shipping the
-- code first makes reads of `libraries` / `media_assets` fail. The build-time
-- preflight (scripts/check-schema.mts) now derives its expectations from
-- schema.ts and will refuse to build until this has run.
--
-- Existing rows are untouched: kind stays 'manual', watch_path stays NULL.
-- ROLLBACK IS AT THE BOTTOM AND WAS WRITTEN FIRST.

-- 1. Allow the new library kind. 'watched' = contents are reconciled from a
--    folder on the operator's computer. Unlike 'smart' (whose membership is
--    derived at query time and never written), a watched folder's files ARE
--    ordinary media_assets rows carrying a real library_id — which is exactly
--    why it must be its own kind rather than a reuse of 'smart'.
ALTER TABLE libraries DROP CONSTRAINT IF EXISTS libraries_kind_check;
ALTER TABLE libraries
  ADD CONSTRAINT libraries_kind_check CHECK (kind IN ('manual', 'smart', 'watched'));

-- 2. The folder being watched. NULL for every other kind.
--    Deliberately its own column rather than smuggled into `rules`, which is
--    typed and validated as SmartRules (src/lib/smart-folders.ts).
ALTER TABLE libraries
  ADD COLUMN IF NOT EXISTS watch_path text;

-- 3. Where a synced file came from, relative to the watched folder
--    ("backgrounds/sunrise.jpg"). This is the reconcile identity: it survives
--    a rename of the display name and distinguishes two files that share a
--    basename in different sub-folders. NULL for anything not synced.
ALTER TABLE media_assets
  ADD COLUMN IF NOT EXISTS source_rel_path text;

-- Reconcile lists one library at a time, so this is the access path.
CREATE INDEX IF NOT EXISTS idx_media_assets_library_source
  ON media_assets(library_id, source_rel_path);

-- rollback:
--   DROP INDEX IF EXISTS idx_media_assets_library_source;
--   ALTER TABLE media_assets DROP COLUMN IF EXISTS source_rel_path;
--   ALTER TABLE libraries DROP COLUMN IF EXISTS watch_path;
--   ALTER TABLE libraries DROP CONSTRAINT IF EXISTS libraries_kind_check;
--   ALTER TABLE libraries
--     ADD CONSTRAINT libraries_kind_check CHECK (kind IN ('manual', 'smart'));
--   -- NOTE: the constraint rollback FAILS if any library is still kind
--   -- 'watched'. Convert them first — this preserves all media, because a
--   -- watched folder's files are ordinary rows:
--   --   UPDATE libraries SET kind = 'manual', watch_path = NULL
--   --    WHERE kind = 'watched';
--   -- No media_assets row is deleted by any part of this rollback.
