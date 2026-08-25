-- A2 (song re-chunk): index song_slides.song_id.
-- The FK to songs does NOT auto-create an index in Postgres, yet every slide
-- read and the re-chunk delete filter on song_id. Additive + idempotent + safe
-- (no lock of note on a small table). Apply to dev + prod before/with the
-- reChunkSong / reChunkAllSongs actions (Speed fold, SONG_SLIDE_CHUNKING_SPEC §3a-5).

CREATE INDEX IF NOT EXISTS idx_song_slides_song ON song_slides (song_id);

-- Rollback (safe, additive migration):
-- DROP INDEX IF EXISTS idx_song_slides_song;
