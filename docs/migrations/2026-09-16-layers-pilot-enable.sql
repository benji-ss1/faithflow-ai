-- Layers default-on rollout — STEP 1: PILOT CHURCH ONLY (user-directed 2026-09-16).
-- Data-only, no schema change. Run ONLY after the Vercel preview has been
-- verified in the desktop app on a real projector, AND after
-- NEXT_PUBLIC_LAYERS_V2=1 is set in Vercel (the global render switch).
-- Replace <PILOT_CHURCH_ID> with the pilot church's uuid.
--
-- rollback (write-first): UPDATE church_preferences SET layers_v2 = false, updated_at = now() WHERE church_id = '<PILOT_CHURCH_ID>';

INSERT INTO church_preferences (church_id, layers_v2)
VALUES ('<PILOT_CHURCH_ID>', true)
ON CONFLICT (church_id) DO UPDATE SET layers_v2 = true, updated_at = now();
