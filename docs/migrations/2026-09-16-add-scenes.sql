-- ProPresenter parity — SCENES (church-scoped named [screen × layer] routing + per-screen theme).
-- ADDITIVE + IDEMPOTENT. APPLY THIS MIGRATION BEFORE THE APP CODE DEPLOYS:
-- Drizzle `db.select()` lists every schema column, so the table/column must exist
-- before the new code that reads them ships (see docs/AI_HANDOFF.md, deploy order).
--
-- A scene stores ROUTING ONLY — which layers each screen shows and an optional
-- per-screen theme. Live output state (current slide, layer values) is never
-- persisted here; a scene is a recallable recipe, like timer_definitions.
-- The 5 built-in scenes (Worship/Teaching/Announcement/Offering/Pre-Service)
-- live in code (src/lib/scenes.ts), NOT as rows — nothing to seed, nothing a
-- user can delete.

CREATE TABLE IF NOT EXISTS scenes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  name text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_built_in boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scenes_church ON scenes(church_id, sort_order);

-- Row-level security: the app connects as the table OWNER (bypasses RLS), so
-- enabling it changes nothing for the app but DENIES any future anon/authenticated
-- client — matching every other tenant table (timer_definitions, macros, themes).
ALTER TABLE scenes ENABLE ROW LEVEL SECURITY;

-- Per-church opt-in for the Scenes UI (default OFF, so applying this migration
-- changes nothing for any existing church until it is switched on deliberately).
ALTER TABLE church_preferences ADD COLUMN IF NOT EXISTS scenes_enabled boolean NOT NULL DEFAULT false;

-- rollback:
--   DROP TABLE IF EXISTS scenes;
--   ALTER TABLE church_preferences DROP COLUMN IF EXISTS scenes_enabled;
