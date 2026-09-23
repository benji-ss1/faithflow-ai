-- Row-Level Security POLICIES for per-church isolation (2026-09-23).
--
-- ═══ THIS MIGRATION IS INERT ON APPLY. ═══
-- Verified on production before writing it:
--   current_user = postgres | rolbypassrls = TRUE
--   tables_with_rls_on = 60 | policies_defined = 0
-- Postgres SKIPS row-level security entirely for a role with rolbypassrls, so
-- adding policies changes NOTHING for the running application. The 2026-08-18
-- lockdown turned RLS on with no policies, which locks out anon/PostgREST but
-- contributes nothing to isolation BETWEEN CHURCHES — today that rests entirely
-- on app-layer church_id filtering.
--
-- So this is step one of two, on purpose:
--   1. (this) land the policies + prove them in CI against a NON-bypassing role
--   2. (separate, needs sign-off) move the app to that non-bypassing role
-- Step 2 is the one that can break things, and it stays a small reviewable
-- change instead of a leap, precisely because step 1 landed first.
--
-- HOW SCOPING WORKS: every policy reads the `app.current_church_id` GUC, set
-- per transaction with SET LOCAL by withChurchScope() in src/lib/db/rls.ts.
-- SET LOCAL dies with the transaction, so it cannot leak into the next checkout
-- of a pooled connection — which matters because we pool.
--
-- FAIL CLOSED, AND WITHOUT THROWING:
--   current_setting(..., true) -> NULL when unset (rather than an error)
--   nullif(..., '')            -> NULL when set to an empty string
-- Both matter. `''::uuid` RAISES "invalid input syntax for type uuid", so
-- without the nullif an unscoped query would ERROR instead of returning
-- nothing — a worse failure than the one we are preventing. Verified in psql.
--
-- ADDITIVE + IDEMPOTENT. Rollback at the bottom.

BEGIN;

-- Enable RLS on every table we police. Production already has RLS on (the
-- 2026-08-18 lockdown), but a fresh database -- CI, a new environment -- does
-- not, and a policy on a table with RLS off is decoration: it is never
-- consulted. Stating it here makes the migration deterministic everywhere.
-- This does NOT change behaviour for the current app role, which has
-- rolbypassrls; enforcement begins only at the step-2 role cutover.
ALTER TABLE public.announcement_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audio_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.church_audio_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.church_learned_keyterms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.church_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.church_service_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_pairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.libraries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.licensed_translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.macros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.migration_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.openflow_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pptx_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sermon_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sermon_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.song_arrangements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.song_bundle_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.song_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.songs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stage_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stage_screens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timer_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sermon_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.song_slides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcript_segments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS church_isolation ON public.announcement_presets;
CREATE POLICY church_isolation ON public.announcement_presets
  USING (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid)
  WITH CHECK (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid);
DROP POLICY IF EXISTS church_isolation ON public.announcements;
CREATE POLICY church_isolation ON public.announcements
  USING (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid)
  WITH CHECK (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid);
DROP POLICY IF EXISTS church_isolation ON public.audio_sessions;
CREATE POLICY church_isolation ON public.audio_sessions
  USING (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid)
  WITH CHECK (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid);
DROP POLICY IF EXISTS church_isolation ON public.church_audio_profiles;
CREATE POLICY church_isolation ON public.church_audio_profiles
  USING (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid)
  WITH CHECK (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid);
DROP POLICY IF EXISTS church_isolation ON public.church_learned_keyterms;
CREATE POLICY church_isolation ON public.church_learned_keyterms
  USING (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid)
  WITH CHECK (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid);
DROP POLICY IF EXISTS church_isolation ON public.church_preferences;
CREATE POLICY church_isolation ON public.church_preferences
  USING (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid)
  WITH CHECK (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid);
DROP POLICY IF EXISTS church_isolation ON public.church_service_patterns;
CREATE POLICY church_isolation ON public.church_service_patterns
  USING (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid)
  WITH CHECK (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid);
DROP POLICY IF EXISTS church_isolation ON public.device_pairs;
CREATE POLICY church_isolation ON public.device_pairs
  USING (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid)
  WITH CHECK (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid);
DROP POLICY IF EXISTS church_isolation ON public.feedback;
CREATE POLICY church_isolation ON public.feedback
  USING (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid)
  WITH CHECK (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid);
DROP POLICY IF EXISTS church_isolation ON public.invitations;
CREATE POLICY church_isolation ON public.invitations
  USING (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid)
  WITH CHECK (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid);
DROP POLICY IF EXISTS church_isolation ON public.libraries;
CREATE POLICY church_isolation ON public.libraries
  USING (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid)
  WITH CHECK (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid);
DROP POLICY IF EXISTS church_isolation ON public.licensed_translations;
CREATE POLICY church_isolation ON public.licensed_translations
  USING (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid)
  WITH CHECK (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid);
DROP POLICY IF EXISTS church_isolation ON public.macros;
CREATE POLICY church_isolation ON public.macros
  USING (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid)
  WITH CHECK (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid);
DROP POLICY IF EXISTS church_isolation ON public.media_assets;
CREATE POLICY church_isolation ON public.media_assets
  USING (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid)
  WITH CHECK (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid);
DROP POLICY IF EXISTS church_isolation ON public.message_templates;
CREATE POLICY church_isolation ON public.message_templates
  USING (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid)
  WITH CHECK (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid);
DROP POLICY IF EXISTS church_isolation ON public.migration_jobs;
CREATE POLICY church_isolation ON public.migration_jobs
  USING (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid)
  WITH CHECK (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid);
DROP POLICY IF EXISTS church_isolation ON public.openflow_conversations;
CREATE POLICY church_isolation ON public.openflow_conversations
  USING (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid)
  WITH CHECK (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid);
DROP POLICY IF EXISTS church_isolation ON public.pptx_imports;
CREATE POLICY church_isolation ON public.pptx_imports
  USING (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid)
  WITH CHECK (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid);
DROP POLICY IF EXISTS church_isolation ON public.scenes;
CREATE POLICY church_isolation ON public.scenes
  USING (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid)
  WITH CHECK (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid);
DROP POLICY IF EXISTS church_isolation ON public.sermon_chunks;
CREATE POLICY church_isolation ON public.sermon_chunks
  USING (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid)
  WITH CHECK (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid);
DROP POLICY IF EXISTS church_isolation ON public.sermon_metadata;
CREATE POLICY church_isolation ON public.sermon_metadata
  USING (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid)
  WITH CHECK (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid);
DROP POLICY IF EXISTS church_isolation ON public.service_plans;
CREATE POLICY church_isolation ON public.service_plans
  USING (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid)
  WITH CHECK (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid);
DROP POLICY IF EXISTS church_isolation ON public.settings;
CREATE POLICY church_isolation ON public.settings
  USING (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid)
  WITH CHECK (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid);
DROP POLICY IF EXISTS church_isolation ON public.song_arrangements;
CREATE POLICY church_isolation ON public.song_arrangements
  USING (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid)
  WITH CHECK (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid);
DROP POLICY IF EXISTS church_isolation ON public.song_bundle_purchases;
CREATE POLICY church_isolation ON public.song_bundle_purchases
  USING (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid)
  WITH CHECK (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid);
DROP POLICY IF EXISTS church_isolation ON public.song_groups;
CREATE POLICY church_isolation ON public.song_groups
  USING (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid)
  WITH CHECK (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid);
DROP POLICY IF EXISTS church_isolation ON public.songs;
CREATE POLICY church_isolation ON public.songs
  USING (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid)
  WITH CHECK (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid);
DROP POLICY IF EXISTS church_isolation ON public.stage_layouts;
CREATE POLICY church_isolation ON public.stage_layouts
  USING (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid)
  WITH CHECK (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid);
DROP POLICY IF EXISTS church_isolation ON public.stage_screens;
CREATE POLICY church_isolation ON public.stage_screens
  USING (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid)
  WITH CHECK (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid);
DROP POLICY IF EXISTS church_isolation ON public.subscriptions;
CREATE POLICY church_isolation ON public.subscriptions
  USING (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid)
  WITH CHECK (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid);
DROP POLICY IF EXISTS church_isolation ON public.themes;
CREATE POLICY church_isolation ON public.themes
  USING (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid)
  WITH CHECK (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid);
DROP POLICY IF EXISTS church_isolation ON public.timer_definitions;
CREATE POLICY church_isolation ON public.timer_definitions
  USING (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid)
  WITH CHECK (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid);
DROP POLICY IF EXISTS church_isolation ON public.users;
CREATE POLICY church_isolation ON public.users
  USING (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid)
  WITH CHECK (church_id = nullif(current_setting('app.current_church_id', true), '')::uuid);

-- These five carry no church_id of their own and inherit it through a foreign
-- key. song_slides holds the LYRICS and transcript_segments the sermon text —
-- leaving either unpoliced would defeat the entire exercise.
DROP POLICY IF EXISTS church_isolation ON public.ai_suggestions;
CREATE POLICY church_isolation ON public.ai_suggestions
  USING (EXISTS (SELECT 1 FROM public.service_plans p WHERE p.id = ai_suggestions.service_plan_id AND p.church_id = nullif(current_setting('app.current_church_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM public.service_plans p WHERE p.id = ai_suggestions.service_plan_id AND p.church_id = nullif(current_setting('app.current_church_id', true), '')::uuid));
DROP POLICY IF EXISTS church_isolation ON public.sermon_summaries;
CREATE POLICY church_isolation ON public.sermon_summaries
  USING (EXISTS (SELECT 1 FROM public.service_plans p WHERE p.id = sermon_summaries.service_plan_id AND p.church_id = nullif(current_setting('app.current_church_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM public.service_plans p WHERE p.id = sermon_summaries.service_plan_id AND p.church_id = nullif(current_setting('app.current_church_id', true), '')::uuid));
DROP POLICY IF EXISTS church_isolation ON public.service_items;
CREATE POLICY church_isolation ON public.service_items
  USING (EXISTS (SELECT 1 FROM public.service_plans p WHERE p.id = service_items.service_plan_id AND p.church_id = nullif(current_setting('app.current_church_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM public.service_plans p WHERE p.id = service_items.service_plan_id AND p.church_id = nullif(current_setting('app.current_church_id', true), '')::uuid));
DROP POLICY IF EXISTS church_isolation ON public.song_slides;
CREATE POLICY church_isolation ON public.song_slides
  USING (EXISTS (SELECT 1 FROM public.songs p WHERE p.id = song_slides.song_id AND p.church_id = nullif(current_setting('app.current_church_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM public.songs p WHERE p.id = song_slides.song_id AND p.church_id = nullif(current_setting('app.current_church_id', true), '')::uuid));
DROP POLICY IF EXISTS church_isolation ON public.transcript_segments;
CREATE POLICY church_isolation ON public.transcript_segments
  USING (EXISTS (SELECT 1 FROM public.service_plans p WHERE p.id = transcript_segments.service_plan_id AND p.church_id = nullif(current_setting('app.current_church_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM public.service_plans p WHERE p.id = transcript_segments.service_plan_id AND p.church_id = nullif(current_setting('app.current_church_id', true), '')::uuid));

COMMIT;

-- ── ROLLBACK (written first) ────────────────────────────────────────────────
-- BEGIN;
-- DROP POLICY IF EXISTS church_isolation ON public.announcement_presets;
-- DROP POLICY IF EXISTS church_isolation ON public.announcements;
-- DROP POLICY IF EXISTS church_isolation ON public.audio_sessions;
-- DROP POLICY IF EXISTS church_isolation ON public.church_audio_profiles;
-- DROP POLICY IF EXISTS church_isolation ON public.church_learned_keyterms;
-- DROP POLICY IF EXISTS church_isolation ON public.church_preferences;
-- DROP POLICY IF EXISTS church_isolation ON public.church_service_patterns;
-- DROP POLICY IF EXISTS church_isolation ON public.device_pairs;
-- DROP POLICY IF EXISTS church_isolation ON public.feedback;
-- DROP POLICY IF EXISTS church_isolation ON public.invitations;
-- DROP POLICY IF EXISTS church_isolation ON public.libraries;
-- DROP POLICY IF EXISTS church_isolation ON public.licensed_translations;
-- DROP POLICY IF EXISTS church_isolation ON public.macros;
-- DROP POLICY IF EXISTS church_isolation ON public.media_assets;
-- DROP POLICY IF EXISTS church_isolation ON public.message_templates;
-- DROP POLICY IF EXISTS church_isolation ON public.migration_jobs;
-- DROP POLICY IF EXISTS church_isolation ON public.openflow_conversations;
-- DROP POLICY IF EXISTS church_isolation ON public.pptx_imports;
-- DROP POLICY IF EXISTS church_isolation ON public.scenes;
-- DROP POLICY IF EXISTS church_isolation ON public.sermon_chunks;
-- DROP POLICY IF EXISTS church_isolation ON public.sermon_metadata;
-- DROP POLICY IF EXISTS church_isolation ON public.service_plans;
-- DROP POLICY IF EXISTS church_isolation ON public.settings;
-- DROP POLICY IF EXISTS church_isolation ON public.song_arrangements;
-- DROP POLICY IF EXISTS church_isolation ON public.song_bundle_purchases;
-- DROP POLICY IF EXISTS church_isolation ON public.song_groups;
-- DROP POLICY IF EXISTS church_isolation ON public.songs;
-- DROP POLICY IF EXISTS church_isolation ON public.stage_layouts;
-- DROP POLICY IF EXISTS church_isolation ON public.stage_screens;
-- DROP POLICY IF EXISTS church_isolation ON public.subscriptions;
-- DROP POLICY IF EXISTS church_isolation ON public.themes;
-- DROP POLICY IF EXISTS church_isolation ON public.timer_definitions;
-- DROP POLICY IF EXISTS church_isolation ON public.users;
-- DROP POLICY IF EXISTS church_isolation ON public.ai_suggestions;
-- DROP POLICY IF EXISTS church_isolation ON public.sermon_summaries;
-- DROP POLICY IF EXISTS church_isolation ON public.service_items;
-- DROP POLICY IF EXISTS church_isolation ON public.song_slides;
-- DROP POLICY IF EXISTS church_isolation ON public.transcript_segments;
-- COMMIT;
--
-- Note the rollback drops the POLICIES but deliberately does not disable RLS.
-- On production that is correct: the 2026-08-18 lockdown turned RLS on and
-- rolling that back is a separate decision, not a side effect of reverting
-- these policies. On a FRESH database it means rollback leaves you where
-- production already is -- RLS on with no policies -- which is inert for a
-- rolbypassrls role but denies everything to a non-bypassing one. If you are
-- rolling back on a fresh/CI database and want the pre-migration state, also
-- run ALTER TABLE ... DISABLE ROW LEVEL SECURITY for the same 38 tables.
--
-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- select count(*) from pg_policies where schemaname='public' and policyname='church_isolation';
--   expected: 38
