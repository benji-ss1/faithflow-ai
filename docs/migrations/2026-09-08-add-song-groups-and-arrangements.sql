-- ProPresenter parity (§12 / MVP §9) — Song GROUPS + ARRANGEMENTS.
-- Additive + idempotent. Safe to run repeatedly.
--
-- ORDERING (required): APPLY THIS MIGRATION BEFORE THE APP CODE DEPLOYS.
-- The app reads song_slides via Drizzle db.select(), which lists every schema
-- column (incl. the new group_id). If the column is missing at query time those
-- reads error. The loader tolerates a NULL group_id (= ungrouped, natural
-- order == today's behaviour) but NOT an absent column — so migrate first.
--
-- DATA-MODEL CHOICE (why relational, not JSONB-on-songs):
--   Slides are already relational rows (song_slides: order, lyrics, objects_json,
--   stable id). The edit-once-update-everywhere differentiator falls out FOR FREE
--   only if groups reference the PHYSICAL slide rows and arrangements reference
--   groups — an arrangement never copies a slide, it repeats a reference, so
--   editing a slide (existing saveSlideObjects / updateSongSlideText) updates every
--   arrangement instance automatically. Duplicating slides into JSONB-on-songs
--   would fork the source of truth and break edit-once. The arrangement PIN on a
--   playlist item lives in service_items.payload.arrangementId (JSONB), matching
--   the established slideOrder / themeId / pptxSlideOrder precedent — no column,
--   purely additive.

-- 1. song_groups — named, colour-coded sections of ONE song. Church-scoped
--    (defence-in-depth; every read still two-hop verifies via songs.church_id).
CREATE TABLE IF NOT EXISTS song_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid NOT NULL REFERENCES churches(id),
  song_id uuid NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  name text NOT NULL,                       -- display label, e.g. "Verse 1"
  kind text NOT NULL DEFAULT 'custom',      -- verse|chorus|bridge|intro|blank|tag|custom
  color text,                               -- #rrggbb token colour (nullable = palette default by kind)
  "order" integer NOT NULL DEFAULT 0,       -- natural (master) order of the group within the song
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_song_groups_song ON song_groups(song_id, "order");
CREATE INDEX IF NOT EXISTS idx_song_groups_church ON song_groups(church_id);

-- 2. Tolerant group membership on slides. NULL = ungrouped (the no-regression
--    line: a song with no groups projects byte-identically to today). ON DELETE
--    SET NULL so deleting a group never deletes/orphans its slides.
ALTER TABLE song_slides
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES song_groups(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_song_slides_group ON song_slides(group_id);

-- 3. song_arrangements — named orderings of group references, per song. The
--    "order" jsonb is an ARRAY of song_groups.id strings, repeatable (Chorus x3).
--    is_default marks the master arrangement (== natural group order); a song may
--    have at most one default, but the loader never requires one (absence == today).
CREATE TABLE IF NOT EXISTS song_arrangements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid NOT NULL REFERENCES churches(id),
  song_id uuid NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  "order" jsonb NOT NULL DEFAULT '[]'::jsonb,  -- string[] of song_groups.id, repeatable
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_song_arrangements_song ON song_arrangements(song_id, sort);
CREATE INDEX IF NOT EXISTS idx_song_arrangements_church ON song_arrangements(church_id);

-- 4. Arrangement PIN on a playlist item: NO column — carried in
--    service_items.payload.arrangementId (JSONB), consistent with slideOrder /
--    themeId / pptxSlideOrder. Documented here for completeness; no DDL needed.

-- 5. RLS — owner-role model, consistent with the 2026-08-18 lockdown. The app
--    connects as the table owner (bypasses RLS); enabling it denies any future
--    anon/authenticated client, matching every other tenant table.
ALTER TABLE song_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE song_arrangements ENABLE ROW LEVEL SECURITY;

-- rollback:
--   ALTER TABLE song_slides DROP COLUMN IF EXISTS group_id;
--   DROP TABLE IF EXISTS song_arrangements;
--   DROP TABLE IF EXISTS song_groups;
--   (payload.arrangementId keys are inert once no code reads them.)
