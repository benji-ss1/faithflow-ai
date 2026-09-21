/**
 * Scale-to-fit for DESIGNED text boxes — ProPresenter parity (rule 5).
 *
 * THE BUG THIS FIXES: a positioned text object rendered at a fixed font size
 * inside `overflow: hidden`. Type one line too many and it silently disappears
 * off the bottom of the box, on the projector, mid-service, with no warning.
 * ProPresenter never does this — it scales the text to fit.
 *
 * WHY NOT REUSE AutoFitText: that engine is for the legacy full-slide lyric
 * path. It PAGINATES and enforces a 24px readability floor — neither is what
 * PP7 does inside a designed box, where the text simply scales. Reusing it here
 * would import two behaviours we explicitly do not want.
 *
 * PP7's four modes (RV "Guide to Using Themes"):
 *   - scale DOWN to fit      → shrink when too big, never grow
 *   - scale UP to fit        → grow to fill, never shrink
 *   - scale UP OR DOWN       → always fill the box
 *   - fit container to text  → resize the BOX, not the text (not implemented —
 *                              it changes geometry, so it belongs in the editor)
 *
 * DEFAULT IS "down", chosen deliberately: text that already fits is left at
 * exactly its authored size, so every existing slide renders byte-identically.
 * Only text that was ALREADY being clipped changes — from invisible to visible.
 * That is a fix, not a regression.
 *
 * This file is pure arithmetic so it can be unit-tested without a DOM. The
 * measuring lives in the renderer.
 */

export type TextScaleMode = "none" | "down" | "up" | "both";

export const DEFAULT_TEXT_SCALE: TextScaleMode = "down";

/** How far we will ever scale, so a pathological case cannot produce a
 *  zero-height or absurdly huge glyph. */
export const MIN_FIT_SCALE = 0.15;
export const MAX_FIT_SCALE = 4;

export type Measured = {
  /** Natural content size at the current font size. */
  contentW: number;
  contentH: number;
  /** Inner box the text must fit inside. */
  boxW: number;
  boxH: number;
};

/**
 * The scale to apply to the current font size so the content fits `mode`.
 * Returns 1 when nothing should change.
 *
 * Text does not scale perfectly linearly (wrapping changes as size changes), so
 * the renderer applies this and re-measures a bounded number of times. Each
 * pass moves strictly toward a fit, so it converges.
 */
export function fitScale(m: Measured, mode: TextScaleMode = DEFAULT_TEXT_SCALE): number {
  if (mode === "none") return 1;
  // Degenerate box or unmeasured content: do nothing rather than guess.
  if (!(m.boxW > 0 && m.boxH > 0 && m.contentW > 0 && m.contentH > 0)) return 1;
  if (![m.boxW, m.boxH, m.contentW, m.contentH].every(Number.isFinite)) return 1;

  const ratio = Math.min(m.boxW / m.contentW, m.boxH / m.contentH);
  if (!Number.isFinite(ratio) || ratio <= 0) return 1;

  const overflowing = ratio < 1;
  // Only act in the direction this mode allows.
  if (overflowing && mode === "up") return 1;
  if (!overflowing && mode === "down") return 1;

  return clampScale(ratio);
}

export function clampScale(s: number): number {
  if (!Number.isFinite(s)) return 1;
  return Math.max(MIN_FIT_SCALE, Math.min(MAX_FIT_SCALE, s));
}

/**
 * True when the content still does not fit — the renderer's loop condition.
 * A hair of tolerance stops a sub-pixel rounding difference from looping.
 */
export function overflows(m: Measured, tolerancePx = 0.5): boolean {
  return m.contentH > m.boxH + tolerancePx || m.contentW > m.boxW + tolerancePx;
}
