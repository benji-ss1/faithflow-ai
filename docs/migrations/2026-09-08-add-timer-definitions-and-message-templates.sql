-- Wave 7 — multi-timer definitions + message templates (church-scoped).
-- ADDITIVE + IDEMPOTENT. APPLY THIS MIGRATION BEFORE THE APP CODE DEPLOYS:
-- Drizzle `db.select()` lists every schema column, so the tables must exist
-- before the new code that reads them ships.
--
-- Runtime timer state (running / remaining / shown) is intentionally NOT stored
-- here — it lives in the operator session only.

DO $$ BEGIN
  CREATE TYPE timer_type AS ENUM ('countdown', 'countdown_to', 'elapsed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS timer_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  name text NOT NULL,
  type timer_type NOT NULL DEFAULT 'countdown',
  duration_sec integer NOT NULL DEFAULT 300,
  target_clock text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_timer_definitions_church ON timer_definitions(church_id, sort_order);

CREATE TABLE IF NOT EXISTS message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  name text NOT NULL,
  text text NOT NULL DEFAULT '',
  position text NOT NULL DEFAULT 'lower-third',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_message_templates_church ON message_templates(church_id, sort_order);

-- Row-level security: the app connects as the table OWNER (bypasses RLS), so
-- enabling it changes nothing for the app but DENIES any future anon/authenticated
-- client — matching every other tenant table (song_groups, libraries, …). Idempotent.
ALTER TABLE timer_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;

-- rollback:
--   DROP TABLE IF EXISTS message_templates;
--   DROP TABLE IF EXISTS timer_definitions;
--   DROP TYPE IF EXISTS timer_type;
