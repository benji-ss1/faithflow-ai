-- 2026-07-29 — ProPresenter migration additions
--
-- 1. songs.default_background_asset_id → mediaAssets.id
--    Every song can have a default background rendered behind lyric slides.
--    Nullable + ON DELETE SET NULL so removing a media asset never orphans a song.
--
-- 2. media_assets.thumb_s3_key
--    320x180 JPEG thumbnail rendered at upload/import time. Nullable — legacy
--    rows have none; the app falls back to the full-size image when missing.

ALTER TABLE songs
  ADD COLUMN IF NOT EXISTS default_background_asset_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'songs_default_background_asset_id_fkey'
  ) THEN
    ALTER TABLE songs
      ADD CONSTRAINT songs_default_background_asset_id_fkey
      FOREIGN KEY (default_background_asset_id)
      REFERENCES media_assets(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_songs_default_background_asset
  ON songs(default_background_asset_id)
  WHERE default_background_asset_id IS NOT NULL;

ALTER TABLE media_assets
  ADD COLUMN IF NOT EXISTS thumb_s3_key text;
