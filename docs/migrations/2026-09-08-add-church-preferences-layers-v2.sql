-- Decoupling Phase 3 — per-church opt-in for the layers/output engine.
-- Additive + idempotent. Default false, so existing churches are unchanged
-- until the flag is deliberately enabled AND the global NEXT_PUBLIC_LAYERS_V2
-- kill-switch is on.
-- ORDERING (required): APPLY THIS MIGRATION BEFORE THE APP CODE DEPLOYS. The
-- operate/operator pages read prefs via Drizzle db.select(), which lists every
-- schema column (incl. layers_v2); if the column is missing at query time those
-- pages error (operate/page has no try/catch → 500). The app-code `?? false`
-- only covers the no-row case, NOT an absent column, so "before or after deploy"
-- is NOT safe — migrate first.

ALTER TABLE church_preferences
  ADD COLUMN IF NOT EXISTS layers_v2 boolean NOT NULL DEFAULT false;

-- rollback: ALTER TABLE church_preferences DROP COLUMN layers_v2;
