-- Layers default-on rollout — STEP 2: EVERY CHURCH (user-directed 2026-09-16).
-- Run ONLY after the pilot church has run real services on Layers without issue.
-- Ship WITH the app change that flips the no-row fallback `prefs?.layersV2 ?? false`
-- → `?? true` (operator/page.tsx, services/[id]/operate/page.tsx, settings/page.tsx)
-- so churches without a preferences row also default on.
-- Churches can then turn Layers off in Settings (admin-only switch).
-- NOTE: the backfill cannot tell "never chose" from "chose off" — run it before
-- announcing the Settings switch, or add a WHERE for churches that opted out.
--
-- rollback (write-first) — restores EXACTLY the pre-step-2 state using the snapshot:
--   ALTER TABLE church_preferences ALTER COLUMN layers_v2 SET DEFAULT false;
--   UPDATE church_preferences SET layers_v2 = false, updated_at = now()
--     WHERE church_id NOT IN (SELECT church_id FROM layers_v2_pre_rollout);
--   DROP TABLE layers_v2_pre_rollout;

-- Snapshot who was already ON (pilot + self-enabled) so the rollback is lossless.
CREATE TABLE IF NOT EXISTS layers_v2_pre_rollout AS
  SELECT church_id FROM church_preferences WHERE layers_v2 = true;
ALTER TABLE layers_v2_pre_rollout ENABLE ROW LEVEL SECURITY;

ALTER TABLE church_preferences ALTER COLUMN layers_v2 SET DEFAULT true;
UPDATE church_preferences SET layers_v2 = true, updated_at = now() WHERE layers_v2 = false;
