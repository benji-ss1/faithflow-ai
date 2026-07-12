-- Row-Level Security foundation for Present Flow.
--
-- Design notes
-- ------------
-- Every tenant table below has a `church_id uuid` column. We enable RLS
-- and add a single policy per operation that checks the session GUC
-- `app.current_church_id` against the row's church_id. A parallel
-- bypass GUC `app.bypass_rls = 'on'` lets pre-session callers (auth
-- tokens, onboarding, seed scripts) execute without a churchId in
-- context. All bypass paths are server-only.
--
-- The current DATABASE_URL user typically OWNS these tables. In
-- Postgres, RLS is not enforced against table owners unless FORCE
-- ROW LEVEL SECURITY is set. We do NOT force it — that keeps the
-- existing app running unchanged while giving us:
--   1. Policies that will bite the moment we swap to a non-owner
--      application role (e.g. `pf_app`).
--   2. An adversarial test (test/adversarial/rls-cross-church.test.ts)
--      that creates a non-owner role and proves the policies block
--      cross-church access.
--
-- Public read tables (bible_translations, bible_verses) are enabled
-- with a permissive SELECT policy so any authenticated caller can
-- read them.
--
-- Rollout plan (out of scope for this migration):
--   - Create a `pf_app` LOGIN role with NO table ownership.
--   - GRANT SELECT/INSERT/UPDATE/DELETE on tenant tables to pf_app.
--   - Point DATABASE_URL at pf_app.
--   - Wrap every app-layer query in withChurchScope() from
--     src/lib/db/rls.ts.

-- Helpers -------------------------------------------------------------

-- We use current_setting(name, missing_ok=true) so an unset GUC yields
-- NULL instead of raising. UUID cast of NULL yields NULL — no match.

-- Tenant tables (church_id direct) -----------------------------------

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'churches',           -- scoped by id (not church_id)
    'users',              -- scoped by church_id (nullable during onboarding)
    'invitations',
    'subscriptions',
    'migration_jobs',
    'service_plans',
    'songs',
    'media_assets',
    'pptx_imports',
    'sermon_metadata',
    'settings',
    'church_service_patterns',
    'church_preferences',
    'licensed_translations',
    'announcements',
    'announcement_presets',
    'themes',
    'device_pairs'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- Special case: churches uses `id` as the tenant key.
DROP POLICY IF EXISTS churches_tenant_isolation ON churches;
CREATE POLICY churches_tenant_isolation ON churches
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR id = NULLIF(current_setting('app.current_church_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR id = NULLIF(current_setting('app.current_church_id', true), '')::uuid
  );

-- Users: scoped by church_id, plus allow rows with NULL church_id
-- (post-signup, pre-onboarding) to be read by their own session via
-- bypass path.
DROP POLICY IF EXISTS users_tenant_isolation ON users;
CREATE POLICY users_tenant_isolation ON users
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR church_id = NULLIF(current_setting('app.current_church_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR church_id = NULLIF(current_setting('app.current_church_id', true), '')::uuid
  );

-- Every other tenant table gets the same church_id policy shape.
DO $$
DECLARE
  t text;
  direct_church_id_tables text[] := ARRAY[
    'invitations',
    'subscriptions',
    'migration_jobs',
    'service_plans',
    'songs',
    'media_assets',
    'pptx_imports',
    'sermon_metadata',
    'settings',
    'church_service_patterns',
    'church_preferences',
    'licensed_translations',
    'announcements',
    'announcement_presets',
    'themes',
    'device_pairs'
  ];
BEGIN
  FOREACH t IN ARRAY direct_church_id_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_isolation ON %I', t, t);
    EXECUTE format($f$
      CREATE POLICY %1$I_tenant_isolation ON %1$I
        USING (
          current_setting('app.bypass_rls', true) = 'on'
          OR church_id = NULLIF(current_setting('app.current_church_id', true), '')::uuid
        )
        WITH CHECK (
          current_setting('app.bypass_rls', true) = 'on'
          OR church_id = NULLIF(current_setting('app.current_church_id', true), '')::uuid
        )
    $f$, t);
  END LOOP;
END $$;

-- Indirect-scoped tables (via service_plan_id or parent FK) ----------
--
-- These have NO direct church_id column. Rather than rebuild the
-- schema, we enable RLS and scope through a subquery on the parent.
-- Slightly slower on writes but keeps schema stable.

-- service_items: parent is service_plans (church_id)
ALTER TABLE service_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_items_tenant_isolation ON service_items;
CREATE POLICY service_items_tenant_isolation ON service_items
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR service_plan_id IN (
      SELECT id FROM service_plans
      WHERE church_id = NULLIF(current_setting('app.current_church_id', true), '')::uuid
    )
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR service_plan_id IN (
      SELECT id FROM service_plans
      WHERE church_id = NULLIF(current_setting('app.current_church_id', true), '')::uuid
    )
  );

-- song_slides: parent is songs (church_id)
ALTER TABLE song_slides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS song_slides_tenant_isolation ON song_slides;
CREATE POLICY song_slides_tenant_isolation ON song_slides
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR song_id IN (
      SELECT id FROM songs
      WHERE church_id = NULLIF(current_setting('app.current_church_id', true), '')::uuid
    )
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR song_id IN (
      SELECT id FROM songs
      WHERE church_id = NULLIF(current_setting('app.current_church_id', true), '')::uuid
    )
  );

-- pptx_slides: parent is pptx_imports (church_id)
ALTER TABLE pptx_slides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pptx_slides_tenant_isolation ON pptx_slides;
CREATE POLICY pptx_slides_tenant_isolation ON pptx_slides
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR pptx_import_id IN (
      SELECT id FROM pptx_imports
      WHERE church_id = NULLIF(current_setting('app.current_church_id', true), '')::uuid
    )
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR pptx_import_id IN (
      SELECT id FROM pptx_imports
      WHERE church_id = NULLIF(current_setting('app.current_church_id', true), '')::uuid
    )
  );

-- transcript_segments: parent is service_plans
ALTER TABLE transcript_segments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS transcript_segments_tenant_isolation ON transcript_segments;
CREATE POLICY transcript_segments_tenant_isolation ON transcript_segments
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR service_plan_id IN (
      SELECT id FROM service_plans
      WHERE church_id = NULLIF(current_setting('app.current_church_id', true), '')::uuid
    )
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR service_plan_id IN (
      SELECT id FROM service_plans
      WHERE church_id = NULLIF(current_setting('app.current_church_id', true), '')::uuid
    )
  );

-- detected_references: parent is transcript_segments → service_plans
ALTER TABLE detected_references ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS detected_references_tenant_isolation ON detected_references;
CREATE POLICY detected_references_tenant_isolation ON detected_references
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR transcript_segment_id IN (
      SELECT ts.id FROM transcript_segments ts
      JOIN service_plans sp ON sp.id = ts.service_plan_id
      WHERE sp.church_id = NULLIF(current_setting('app.current_church_id', true), '')::uuid
    )
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR transcript_segment_id IN (
      SELECT ts.id FROM transcript_segments ts
      JOIN service_plans sp ON sp.id = ts.service_plan_id
      WHERE sp.church_id = NULLIF(current_setting('app.current_church_id', true), '')::uuid
    )
  );

-- ai_suggestions: parent is service_plans
ALTER TABLE ai_suggestions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_suggestions_tenant_isolation ON ai_suggestions;
CREATE POLICY ai_suggestions_tenant_isolation ON ai_suggestions
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR service_plan_id IN (
      SELECT id FROM service_plans
      WHERE church_id = NULLIF(current_setting('app.current_church_id', true), '')::uuid
    )
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR service_plan_id IN (
      SELECT id FROM service_plans
      WHERE church_id = NULLIF(current_setting('app.current_church_id', true), '')::uuid
    )
  );

-- sermon_summaries: parent is service_plans
ALTER TABLE sermon_summaries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sermon_summaries_tenant_isolation ON sermon_summaries;
CREATE POLICY sermon_summaries_tenant_isolation ON sermon_summaries
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR service_plan_id IN (
      SELECT id FROM service_plans
      WHERE church_id = NULLIF(current_setting('app.current_church_id', true), '')::uuid
    )
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR service_plan_id IN (
      SELECT id FROM service_plans
      WHERE church_id = NULLIF(current_setting('app.current_church_id', true), '')::uuid
    )
  );

-- Auth tokens ---------------------------------------------------------
-- Lookups happen pre-session (verify email, password reset) so RLS
-- would be a footgun. Enable it but allow any read/write via bypass —
-- callers are always the server-side auth-actions module which
-- rate-limits and hashes tokens. Never expose direct SQL to a client.
ALTER TABLE auth_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_tokens_server_only ON auth_tokens;
CREATE POLICY auth_tokens_server_only ON auth_tokens
  USING (current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on');

-- Public read tables --------------------------------------------------
-- Bible library is a shared corpus; every authenticated caller can
-- SELECT. No writes from app layer.
ALTER TABLE bible_translations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bible_translations_public_read ON bible_translations;
CREATE POLICY bible_translations_public_read ON bible_translations
  FOR SELECT USING (true);

ALTER TABLE bible_verses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bible_verses_public_read ON bible_verses;
CREATE POLICY bible_verses_public_read ON bible_verses
  FOR SELECT USING (true);
