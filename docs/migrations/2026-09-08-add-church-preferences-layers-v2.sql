-- Decoupling Phase 3 — per-church opt-in for the layers/output engine.
-- Additive + idempotent. Default false, so existing churches are unchanged
-- until the flag is deliberately enabled AND the global NEXT_PUBLIC_LAYERS_V2
-- kill-switch is on. Code tolerates the column's absence (defaults false), so
-- applying this migration is safe to do before or after the app deploy.

ALTER TABLE church_preferences
  ADD COLUMN IF NOT EXISTS layers_v2 boolean NOT NULL DEFAULT false;
