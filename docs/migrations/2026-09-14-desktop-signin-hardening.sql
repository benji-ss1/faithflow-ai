-- Desktop sign-in hardening (security review 2026-09-14).
--   1. users.session_version  — revocable sessions ("sign out all devices",
--      password reset). Embedded in the JWT; checked on the 5-min refresh.
--   2. device_pair_requests   — server-side record of each desktop pairing
--      request (device/geo shown to the approver) + ATOMIC first-approver-wins
--      claim (UPDATE ... WHERE claimed_by_user_id IS NULL RETURNING).
--
-- Additive + idempotent. Safe to run repeatedly.
-- ORDERING (required): APPLY BEFORE THE APP CODE DEPLOYS — auth.ts selects
-- users.session_version and the pairing routes write device_pair_requests.
--
-- ROLLBACK (written first; run only AFTER reverting the app code):
--   DROP TABLE IF EXISTS device_pair_requests;
--   ALTER TABLE users DROP COLUMN IF EXISTS session_version;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS device_pair_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  expires_at timestamp NOT NULL,
  ip text,
  user_agent text,
  country text,
  city text,
  claimed_by_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  claimed_at timestamp,
  consumed_at timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS device_pair_requests_code_hash_uq ON device_pair_requests (code_hash);
CREATE INDEX IF NOT EXISTS device_pair_requests_expires_idx ON device_pair_requests (expires_at);

-- RLS: server-only table (accessed with the service connection, never via the
-- Supabase anon/authenticated API). Enable RLS with no policies = deny-all for
-- PostgREST roles, matching the other server-only auth tables.
ALTER TABLE device_pair_requests ENABLE ROW LEVEL SECURITY;
