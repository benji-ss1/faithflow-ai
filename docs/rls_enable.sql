-- ============================================================
-- PresentFlow — Row Level Security (RLS) Enable Script
-- ============================================================
--
-- WHAT THIS DOES:
--   1. Enables RLS on every tenant-scoped table.
--   2. Adds two bypass policies per table (postgres superuser + service_role).
--   3. By default, all other roles (anon, authenticated, etc.) are DENIED
--      access to tenant data — this is the security win.
--
-- WHY THIS IS SAFE:
--   - The app's DATABASE_URL connects as the `postgres` user (Supabase's
--     superuser). In PostgreSQL, a superuser bypasses RLS automatically, so
--     ALL existing server-side queries continue working with zero changes.
--   - The explicit policies below are belt-and-suspenders: they also cover
--     the `service_role` (PostgREST / Supabase JS client with service key).
--   - Supabase Realtime in this project uses BROADCAST channels only, NOT
--     postgres_changes subscriptions — so no realtime reads are blocked.
--   - The Bible library (bible_verses, bible_translations) is a documented
--     global exception — RLS is NOT enabled on those tables here.
--
-- HOW TO APPLY:
--   Option A (recommended):
--     Supabase Dashboard → SQL Editor → paste this file → Run
--   Option B (CLI):
--     supabase db push  (if using migration files)
--   Option C (psql):
--     psql "$DATABASE_URL" -f drizzle/rls_enable.sql
--
-- REVERTING (if something breaks):
--   Run: ALTER TABLE <table> DISABLE ROW LEVEL SECURITY;
--   That instantly disables RLS on that table. Nothing is destructive.
--
-- TABLES INTENTIONALLY EXCLUDED FROM RLS:
--   - bible_verses          : global shared data, no church_id
--   - bible_translations    : global shared data, no church_id
--   - churches              : read by anyone joining (auth-gated at app layer)
-- ============================================================

-- Helper macro: enable RLS + add bypass policies for both DB roles.
-- We use DO $$ ... END $$ blocks so the script is idempotent (safe to
-- re-run; existing policies just throw "already exists" notices, not errors).

-- ── Tenant-scoped tables ─────────────────────────────────────────────────────

DO $$ BEGIN
  -- users
  ALTER TABLE users ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'users' AND policyname = 'rls_bypass_postgres') THEN
    CREATE POLICY rls_bypass_postgres ON users TO postgres USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'users' AND policyname = 'rls_bypass_service_role') THEN
    CREATE POLICY rls_bypass_service_role ON users TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE auth_tokens ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'auth_tokens' AND policyname = 'rls_bypass_postgres') THEN
    CREATE POLICY rls_bypass_postgres ON auth_tokens TO postgres USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'auth_tokens' AND policyname = 'rls_bypass_service_role') THEN
    CREATE POLICY rls_bypass_service_role ON auth_tokens TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'invitations' AND policyname = 'rls_bypass_postgres') THEN
    CREATE POLICY rls_bypass_postgres ON invitations TO postgres USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'invitations' AND policyname = 'rls_bypass_service_role') THEN
    CREATE POLICY rls_bypass_service_role ON invitations TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'subscriptions' AND policyname = 'rls_bypass_postgres') THEN
    CREATE POLICY rls_bypass_postgres ON subscriptions TO postgres USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'subscriptions' AND policyname = 'rls_bypass_service_role') THEN
    CREATE POLICY rls_bypass_service_role ON subscriptions TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE song_bundle_purchases ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'song_bundle_purchases' AND policyname = 'rls_bypass_postgres') THEN
    CREATE POLICY rls_bypass_postgres ON song_bundle_purchases TO postgres USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'song_bundle_purchases' AND policyname = 'rls_bypass_service_role') THEN
    CREATE POLICY rls_bypass_service_role ON song_bundle_purchases TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE migration_jobs ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'migration_jobs' AND policyname = 'rls_bypass_postgres') THEN
    CREATE POLICY rls_bypass_postgres ON migration_jobs TO postgres USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'migration_jobs' AND policyname = 'rls_bypass_service_role') THEN
    CREATE POLICY rls_bypass_service_role ON migration_jobs TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE service_plans ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'service_plans' AND policyname = 'rls_bypass_postgres') THEN
    CREATE POLICY rls_bypass_postgres ON service_plans TO postgres USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'service_plans' AND policyname = 'rls_bypass_service_role') THEN
    CREATE POLICY rls_bypass_service_role ON service_plans TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE service_items ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'service_items' AND policyname = 'rls_bypass_postgres') THEN
    CREATE POLICY rls_bypass_postgres ON service_items TO postgres USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'service_items' AND policyname = 'rls_bypass_service_role') THEN
    CREATE POLICY rls_bypass_service_role ON service_items TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE songs ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'songs' AND policyname = 'rls_bypass_postgres') THEN
    CREATE POLICY rls_bypass_postgres ON songs TO postgres USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'songs' AND policyname = 'rls_bypass_service_role') THEN
    CREATE POLICY rls_bypass_service_role ON songs TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE song_slides ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'song_slides' AND policyname = 'rls_bypass_postgres') THEN
    CREATE POLICY rls_bypass_postgres ON song_slides TO postgres USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'song_slides' AND policyname = 'rls_bypass_service_role') THEN
    CREATE POLICY rls_bypass_service_role ON song_slides TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'media_assets' AND policyname = 'rls_bypass_postgres') THEN
    CREATE POLICY rls_bypass_postgres ON media_assets TO postgres USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'media_assets' AND policyname = 'rls_bypass_service_role') THEN
    CREATE POLICY rls_bypass_service_role ON media_assets TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE pptx_imports ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pptx_imports' AND policyname = 'rls_bypass_postgres') THEN
    CREATE POLICY rls_bypass_postgres ON pptx_imports TO postgres USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pptx_imports' AND policyname = 'rls_bypass_service_role') THEN
    CREATE POLICY rls_bypass_service_role ON pptx_imports TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE pptx_slides ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pptx_slides' AND policyname = 'rls_bypass_postgres') THEN
    CREATE POLICY rls_bypass_postgres ON pptx_slides TO postgres USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pptx_slides' AND policyname = 'rls_bypass_service_role') THEN
    CREATE POLICY rls_bypass_service_role ON pptx_slides TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE sermon_metadata ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sermon_metadata' AND policyname = 'rls_bypass_postgres') THEN
    CREATE POLICY rls_bypass_postgres ON sermon_metadata TO postgres USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sermon_metadata' AND policyname = 'rls_bypass_service_role') THEN
    CREATE POLICY rls_bypass_service_role ON sermon_metadata TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'settings' AND policyname = 'rls_bypass_postgres') THEN
    CREATE POLICY rls_bypass_postgres ON settings TO postgres USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'settings' AND policyname = 'rls_bypass_service_role') THEN
    CREATE POLICY rls_bypass_service_role ON settings TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE detected_references ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'detected_references' AND policyname = 'rls_bypass_postgres') THEN
    CREATE POLICY rls_bypass_postgres ON detected_references TO postgres USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'detected_references' AND policyname = 'rls_bypass_service_role') THEN
    CREATE POLICY rls_bypass_service_role ON detected_references TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE ai_suggestions ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ai_suggestions' AND policyname = 'rls_bypass_postgres') THEN
    CREATE POLICY rls_bypass_postgres ON ai_suggestions TO postgres USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ai_suggestions' AND policyname = 'rls_bypass_service_role') THEN
    CREATE POLICY rls_bypass_service_role ON ai_suggestions TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE transcript_segments ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'transcript_segments' AND policyname = 'rls_bypass_postgres') THEN
    CREATE POLICY rls_bypass_postgres ON transcript_segments TO postgres USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'transcript_segments' AND policyname = 'rls_bypass_service_role') THEN
    CREATE POLICY rls_bypass_service_role ON transcript_segments TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE sermon_chunks ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sermon_chunks' AND policyname = 'rls_bypass_postgres') THEN
    CREATE POLICY rls_bypass_postgres ON sermon_chunks TO postgres USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sermon_chunks' AND policyname = 'rls_bypass_service_role') THEN
    CREATE POLICY rls_bypass_service_role ON sermon_chunks TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE church_service_patterns ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'church_service_patterns' AND policyname = 'rls_bypass_postgres') THEN
    CREATE POLICY rls_bypass_postgres ON church_service_patterns TO postgres USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'church_service_patterns' AND policyname = 'rls_bypass_service_role') THEN
    CREATE POLICY rls_bypass_service_role ON church_service_patterns TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE church_preferences ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'church_preferences' AND policyname = 'rls_bypass_postgres') THEN
    CREATE POLICY rls_bypass_postgres ON church_preferences TO postgres USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'church_preferences' AND policyname = 'rls_bypass_service_role') THEN
    CREATE POLICY rls_bypass_service_role ON church_preferences TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE licensed_translations ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'licensed_translations' AND policyname = 'rls_bypass_postgres') THEN
    CREATE POLICY rls_bypass_postgres ON licensed_translations TO postgres USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'licensed_translations' AND policyname = 'rls_bypass_service_role') THEN
    CREATE POLICY rls_bypass_service_role ON licensed_translations TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE sermon_summaries ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sermon_summaries' AND policyname = 'rls_bypass_postgres') THEN
    CREATE POLICY rls_bypass_postgres ON sermon_summaries TO postgres USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sermon_summaries' AND policyname = 'rls_bypass_service_role') THEN
    CREATE POLICY rls_bypass_service_role ON sermon_summaries TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'announcements' AND policyname = 'rls_bypass_postgres') THEN
    CREATE POLICY rls_bypass_postgres ON announcements TO postgres USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'announcements' AND policyname = 'rls_bypass_service_role') THEN
    CREATE POLICY rls_bypass_service_role ON announcements TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE announcement_presets ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'announcement_presets' AND policyname = 'rls_bypass_postgres') THEN
    CREATE POLICY rls_bypass_postgres ON announcement_presets TO postgres USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'announcement_presets' AND policyname = 'rls_bypass_service_role') THEN
    CREATE POLICY rls_bypass_service_role ON announcement_presets TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE themes ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'themes' AND policyname = 'rls_bypass_postgres') THEN
    CREATE POLICY rls_bypass_postgres ON themes TO postgres USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'themes' AND policyname = 'rls_bypass_service_role') THEN
    CREATE POLICY rls_bypass_service_role ON themes TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE device_pairs ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'device_pairs' AND policyname = 'rls_bypass_postgres') THEN
    CREATE POLICY rls_bypass_postgres ON device_pairs TO postgres USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'device_pairs' AND policyname = 'rls_bypass_service_role') THEN
    CREATE POLICY rls_bypass_service_role ON device_pairs TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'feedback' AND policyname = 'rls_bypass_postgres') THEN
    CREATE POLICY rls_bypass_postgres ON feedback TO postgres USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'feedback' AND policyname = 'rls_bypass_service_role') THEN
    CREATE POLICY rls_bypass_service_role ON feedback TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── churches table ──────────────────────────────────────────────────────────
-- churches is not strictly tenant-scoped (it IS the tenant root), but it
-- still contains sensitive data (name, size, location, billing state).
-- Lock it down the same way.
DO $$ BEGIN
  ALTER TABLE churches ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'churches' AND policyname = 'rls_bypass_postgres') THEN
    CREATE POLICY rls_bypass_postgres ON churches TO postgres USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'churches' AND policyname = 'rls_bypass_service_role') THEN
    CREATE POLICY rls_bypass_service_role ON churches TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── bible_verses & bible_translations: intentionally EXCLUDED ──────────────
-- These are global reference data with no church_id. They are a documented
-- exception in src/lib/server/bible.ts:12-17 and CLAUDE.md rule 5.
-- If we ever serve Bible data directly from the browser (not via server-side
-- API routes), add a SELECT-only anon policy then. Not now.

-- ============================================================
-- Verify: after running this, check the Supabase dashboard
-- Table Editor → select a table → RLS should show "Enabled".
-- All app behaviour should be unchanged — the postgres/service_role
-- policies ensure server queries continue to work.
-- ============================================================
