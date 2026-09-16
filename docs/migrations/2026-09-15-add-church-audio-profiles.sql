-- Sarah audio setup wizard (2026-09-15): per-church audio setup profile.
--
-- Additive + idempotent. Safe to run repeatedly.
-- ORDERING: apply BEFORE the app code that reads/writes it deploys. The code
-- also tolerates the table being absent (profile load returns empty, save is a
-- no-op with a clear error), so an early deploy degrades instead of breaking.
--
-- ROLLBACK (written first; run only AFTER reverting the app code):
--   DROP TABLE IF EXISTS church_audio_profiles;

CREATE TABLE IF NOT EXISTS church_audio_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid NOT NULL UNIQUE REFERENCES churches(id) ON DELETE CASCADE,
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  confirmed_application_id uuid,
  updated_by_user_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Server-only table (service connection). RLS on with no policies = deny-all for
-- PostgREST anon/authenticated roles, matching the other server-only tables.
ALTER TABLE church_audio_profiles ENABLE ROW LEVEL SECURITY;
