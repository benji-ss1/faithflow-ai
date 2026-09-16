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
 *   2. `shouldRearmSlideOnSend` — the R1b re-arm decision: any disabled slide
 *      override re-arms on the next send (2026-09-16 — T/"Clear Lyrics" is a
 *      temporary hide; see the function doc).
 */
import type { BackgroundSpec, LayerWire, SlidePayload } from "@/lib/broadcast";
import { slideDesignSig } from "@/lib/broadcast";

/**
 * CONTENT-only key for a live slide (2026-09-16, Victor): what the audience reads
 * or sees, ignoring styling. Two sends with the same key are a restyle (theme,
 * per-slide look, background image) — they must NOT re-arm hidden lyrics.
 */
export function liveContentKey(s: SlidePayload | null | undefined): string {
  if (!s) return "e";
  switch (s.kind) {
    case "text": {
      // A framed media image is an EMPTY-text slide carrying image objects. Without
      // the object identity every such slide keys "t:|", so after T (clear) a
      // DIFFERENT edited image would never re-arm the slide layer. Only empty-text
      // slides get this — worded slides keep their style-independent key.
      if (!s.text && Array.isArray(s.objects) && s.objects.length > 0) {
        // Full design signature (bg colour/image + EVERY object incl. all images'
        // url/fit/crop/box) so a background change or added objects also re-arm.
        return `t:|${s.reference ?? ""}|d:${slideDesignSig(s)}`;
      }
      return `t:${s.text}|${s.reference ?? ""}`;
    }
    case "image": return `i:${s.url}`;
    case "video": return `v:${s.url}`;
    case "logo": return `l:${s.url ?? ""}`;
    default: return s.kind;
  }
}

/**
 * Does a slide/media layer payload genuinely paint (drives the layer "active"
 * indicator)? Worded text slides and image/video slides do. An EMPTY-text slide
 * counts only when it carries an IMAGE object (a framed media picture) — a blank
 * designed slide with only decorative shapes stays inactive, as before.
 */
export function slidePayloadActive(s: SlidePayload | null | undefined): boolean {
  if (!s) return false;
  if (s.kind === "empty") return false;
  if (s.kind === "text") {
    if (!!s.text && s.text.trim().length > 0) return true;
    return Array.isArray(s.objects) && s.objects.some((o) => o.kind === "image");
  }
  return true; // image/video/etc.
}

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
 * 2026-09-16 (user-directed, supersedes the Wave 5A "eye-hide persists across
 * advances" rule FOR THE SLIDE LAYER ONLY): the rail's T ("Clear Lyrics") is a
 * TEMPORARY hide, ProPresenter-style — the next slide sent live (operator click,
 * AI scripture auto-fire, or a re-send of the same slide) brings the text back
 * with no extra keypress. So ANY disabled slide override re-arms, whether it
 * came from the eye/rail toggle or a CLEAR. Background/camera/logo eye-hides are
 * untouched (they never flow through this decision) and still persist.
 *
 * @param override  the current slide override (if any).
 * @returns true when the disabled slide override should be dropped/re-enabled so
 *          the freshly-sent slide shows.
 */
export function shouldRearmSlideOnSend(override: LayerWire | undefined): boolean {
  return !!override && !override.enabled;
}
