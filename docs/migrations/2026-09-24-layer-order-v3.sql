-- Layer Order V3 (composable layers) — per-church opt-in flag.
-- NOT APPLIED. Code does NOT read this column yet (the flag rides OutputState.layerOrderV3
-- from localStorage/env), so applying it early is harmless and reading it before it
-- exists can never crash db.select.
--
-- ROLLBACK (write/run first if anything goes wrong):
--   ALTER TABLE churches DROP COLUMN IF EXISTS layer_order_v3;
--
-- FORWARD (additive-only):
ALTER TABLE churches ADD COLUMN IF NOT EXISTS layer_order_v3 boolean NOT NULL DEFAULT false;
