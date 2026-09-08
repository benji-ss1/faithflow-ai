-- ProPresenter parity (Phase 3.6) — multiple named Libraries + Playlist section headers.
-- Additive + idempotent. Safe to run repeatedly.
--
-- ORDERING (required): APPLY THIS MIGRATION BEFORE THE APP CODE DEPLOYS.
-- The app reads songs / media_assets via Drizzle db.select(), which lists every
-- schema column (incl. the new library_id). If the column is missing at query
-- time those reads error. The loader tolerates a NULL library_id (= "Default"),
-- but NOT an absent column — so migrate first.
--
-- The 'header' enum value must exist before any service_items row of type
-- 'header' is inserted; ALTER TYPE ... ADD VALUE is autocommit-safe in psql.

-- 1. New non-content playlist item type: a coloured section divider.
--    (ADD VALUE IF NOT EXISTS is idempotent; must run outside an explicit txn.)
ALTER TYPE service_item_type ADD VALUE IF NOT EXISTS 'header';

-- 2. Libraries — named content buckets per church (Songs, Countdowns, …).
CREATE TABLE IF NOT EXISTS libraries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid NOT NULL REFERENCES churches(id),
  name text NOT NULL,
  "order" integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_libraries_church ON libraries(church_id, "order");

-- 3. Tolerant library membership on content. NULL = unassigned ("Default").
--    ON DELETE SET NULL so deleting a library never orphans content.
ALTER TABLE songs
  ADD COLUMN IF NOT EXISTS library_id uuid REFERENCES libraries(id) ON DELETE SET NULL;
ALTER TABLE media_assets
  ADD COLUMN IF NOT EXISTS library_id uuid REFERENCES libraries(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_songs_library ON songs(library_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_library ON media_assets(library_id);

-- 4. RLS — owner-role model, consistent with the 2026-08-18 lockdown. The app
--    connects as the table owner (bypasses RLS); enabling it denies any future
--    anon/authenticated client, matching every other tenant table.
ALTER TABLE libraries ENABLE ROW LEVEL SECURITY;

-- rollback:
--   ALTER TABLE songs DROP COLUMN IF EXISTS library_id;
--   ALTER TABLE media_assets DROP COLUMN IF EXISTS library_id;
--   DROP TABLE IF EXISTS libraries;
--   (the 'header' enum value cannot be dropped from a pgEnum; it is inert if unused.)
