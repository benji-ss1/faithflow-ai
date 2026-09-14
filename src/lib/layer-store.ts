/**
 * layer-store — PURE operator-side layer-store decisions (Decoupling Phase 3,
 * Wave 5A field-bug fix).
 *
 * These are the non-React, deterministic decisions the `useLiveLayers` hook makes
 * so they can be unit-tested at the STORE level (the render-merge resolver in
 * `output-layers-render.ts` is tested separately). Two decisions live here:
 *
 *   1. `reconcileBackgroundOnBaseChange` — when the base Background Template store
 *      changes underneath an existing background OVERRIDE, decide whether to
 *      re-emit a swap. The load-bearing correctness rule (Wave 5A): a background
 *      that the operator HID with the eye (enabled=false) must NEVER be clobbered
 *      when the base store resets to none (e.g. applying a theme with a background
 *      calls setActiveBackgroundId("none")). Clobbering it to a null payload made
 *      SHOW restore nothing — the reported one-way toggle. A HIDDEN override is
 *      left untouched so its captured payload survives for a faithful SHOW.
 *
 *   2. `shouldRearmSlideOnSend` — the R1b re-arm decision. The shipped rule
 *      re-armed ANY disabled slide override on a new send so a forgotten block
 *      couldn't swallow the next slide. Wave 5A refines it (user-directed): an
 *      EYE-hide PERSISTS across slide advances (the operator asked for hide to
 *      survive advances), while a CLEAR-style block (trash) still re-arms so it
 *      can't permanently swallow output. The two are otherwise indistinguishable
 *      (slide patches carry no payload, R1a), so the hook tracks which layers were
 *      eye-hidden and passes that in here.
 */
import type { BackgroundSpec, LayerWire } from "@/lib/broadcast";

/** Decision for the background reconcile effect. */
export interface BackgroundReconcileDecision {
  /** Emit a fresh-rev background swap carrying `spec`? */
  emitSwap: boolean;
  /** The spec to swap to (only meaningful when `emitSwap`). */
  spec: BackgroundSpec | null;
}

/**
 * Decide whether a base Background Template change should re-emit a swap over an
 * existing background override.
 *
 * - No existing override → the derived base layer already tracks the store, so
 *   nothing to reconcile (common path).
 * - New base is a REAL template (non-null) → show it (out-ranks a stale
 *   clear/hide override — the "swap after clear shows nothing" fix).
 * - New base cleared to none (null):
 *     - override is currently SHOWING (enabled) → follow the clear (honest
 *       single-source: the selector went to none, so clear the override too).
 *     - override is HIDDEN (enabled=false) → DO NOTHING. Preserve the hidden
 *       override's captured payload so a later SHOW restores exactly what was
 *       there (Wave 5A non-destructive-hide guarantee).
 */
export function reconcileBackgroundOnBaseChange(
  existing: LayerWire | undefined,
  newBase: BackgroundSpec | null,
): BackgroundReconcileDecision {
  if (!existing) return { emitSwap: false, spec: null };
  if (newBase != null) return { emitSwap: true, spec: newBase };
  // newBase is null (store cleared/reset).
  if (existing.enabled) return { emitSwap: true, spec: null };
  return { emitSwap: false, spec: null }; // hidden → preserve, restorable
}

/**
 * R1b re-arm decision for the slide layer on a new slide send.
 *
 * @param override   the current slide override (if any).
 * @param eyeHidden  true if the slide layer was hidden via the EYE toggle (as
 *                   opposed to a CLEAR/trash block).
 * @returns true when the disabled slide override should be dropped/re-enabled so
 *          the freshly-sent slide shows. An EYE-hide persists (returns false);
 *          only a CLEAR-style block re-arms.
 */
export function shouldRearmSlideOnSend(
  override: LayerWire | undefined,
  eyeHidden: boolean,
): boolean {
  if (!override || override.enabled) return false; // nothing disabled to re-arm
  if (eyeHidden) return false;                     // EYE-hide persists across advances
  return true;                                     // CLEAR-style block → re-arm
}
