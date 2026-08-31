-- Media-library speed: index media_assets on (church_id, created_at).
-- listMedia (services.ts) does where(church_id).orderBy(created_at ASC) on every
-- media-panel open. With no index the table has neither a church_id index nor a
-- created_at index, so each open is a sequential scan + sort. This composite
-- index serves both the church filter and the ordering as an index range scan.
-- Additive + idempotent + safe. CONCURRENTLY avoids a write-lock on prod (run it
-- OUTSIDE a transaction — Supabase SQL editor runs statements individually).

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_media_assets_church_created
  ON media_assets (church_id, created_at);

-- Rollback (safe, additive migration):
-- DROP INDEX CONCURRENTLY IF EXISTS idx_media_assets_church_created;
