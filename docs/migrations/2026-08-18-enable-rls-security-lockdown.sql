-- 2026-08-18 — Security lockdown (Supabase Security Advisor remediation)
--
-- Triggered by a Supabase advisory email ("Table publicly accessible —
-- rls_disabled_in_public"). Applied directly to the production project
-- mdjdemrtykflfucggbqt (eu-west-1) via the Supabase MCP; recorded here for
-- reproducibility. Re-runnable and idempotent.
--
-- ── Access model (why enabling RLS with NO policies is correct & safe here) ──
--   • The app queries Postgres via Drizzle over DATABASE_URL as the table-OWNER
--     role, which BYPASSES row-level security. Server code is unaffected.
--   • The service_role key (server-side) also bypasses RLS.
--   • Cross-device sync (src/lib/realtime.ts) uses Supabase Realtime BROADCAST
--     channels, which are NOT governed by table RLS.
--   • Nothing reads these tables via the anon/authenticated PostgREST roles.
--   Proof: audio_sessions, church_learned_keyterms, feedback, sermon_chunks and
--   song_bundle_purchases already ran RLS-enabled-with-no-policy in production
--   with the app working — same config now applied to every table.
--   Net effect: RLS ON blocks anonymous (public anon-key) read/edit/delete,
--   while the app keeps full access. This is the app-layer-tenant-isolation
--   posture documented in CLAUDE.md (church_id scoping in server actions), now
--   backed by a hard "no anonymous PostgREST access" boundary.
--
--   NOTE: this is a public-access lockdown, NOT per-tenant RLS. If the app is
--   ever changed to read/write these tables through the anon/authenticated
--   Supabase client, each table will need church_id-scoped policies first.

-- 1) Enable RLS on every public table (idempotent). ENABLE (not FORCE) so the
--    owner role the app connects as keeps full access.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security;', t.tablename);
  end loop;
end $$;

-- 2) A SECURITY DEFINER helper must not be callable by the public API roles.
revoke execute on function public.rls_auto_enable() from anon, authenticated, public;

-- 3) Move pgvector out of the public schema (advisor: extension_in_public).
--    Safe because the database search_path is already '"$user", public,
--    extensions', so the app's unqualified `<=>` operator and `::vector` casts
--    (bible.ts semantic search, sermon RAG, pptx import) still resolve.
--    Verified post-move: `'[1,2,3]'::vector <=> '[4,5,6]'::vector` returns a
--    distance and all 931 sermon_chunks embeddings remained intact.
alter extension vector set schema extensions;

-- Result: Supabase Security Advisor shows 0 ERROR / 0 WARN; only INFO
-- "rls_enabled_no_policy" remains, which is the intended server-only state.
--
-- Rollback (only if ever needed):
--   do $$ declare t record; begin
--     for t in select tablename from pg_tables where schemaname='public' loop
--       execute format('alter table public.%I disable row level security;', t.tablename);
--     end loop; end $$;
--   alter extension vector set schema public;
