-- Phase 4 — Action primitives: per-slide actions + Automations (macros).
-- ADDITIVE + IDEMPOTENT. APPLY THIS MIGRATION BEFORE THE APP CODE DEPLOYS:
-- Drizzle `db.select()` lists every schema column, so `song_slides.actions`
-- must exist before the new code that reads it ships (same rule as layers_v2).
--
-- Slide actions for NON-song items (scripture/media/sermon) live in
-- `service_items.payload.slideActions` (JSONB, no column needed) — mirroring the
-- established arrangementId / slideOrder / themeId payload precedent.

-- 1) Per-slide attached actions on song slides (serializable ActionSpec[]).
--    NULL/[] = no actions (no-regression line).
ALTER TABLE song_slides
  ADD COLUMN IF NOT EXISTS actions jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 2) Automations (macros): church-persisted named action lists.
CREATE TABLE IF NOT EXISTS macros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  name text NOT NULL,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_macros_church ON macros(church_id, sort_order);

-- Row-level security: the app connects as the table OWNER (bypasses RLS), so
-- enabling it changes nothing for the app but DENIES any future anon/authenticated
-- client — matching every other tenant table. Idempotent.
ALTER TABLE macros ENABLE ROW LEVEL SECURITY;

-- rollback:
--   DROP TABLE IF EXISTS macros;
--   ALTER TABLE song_slides DROP COLUMN IF EXISTS actions;
