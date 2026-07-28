/**
 * Projector font sizing — JPD post-session Fix 2.
 *
 * Projected text must always be readable from the back of the church:
 * never tiny, never overflowing. Sizes are expressed as a FRACTION OF THE
 * DISPLAY HEIGHT so any resolution (720p, 1080p, 4K) scales automatically.
 *
 * Word-count-banded scaling:
 *   ≤10 words  → 10%  of display height  ("Jesus wept", titles)
 *   ≤25 words  → 7.5%                    (single verse)
 *   ≤50 words  → 5.5%                    (2-3 verses / dense chorus)
 *   ≤80 words  → 4.2%                    (long passage)
 *   else       → 3%   floor              (very long — should be split)
 *
 * Hard clamp: [3%, 12%] of display height. 3% of 1080p = 32.4px — the
 * sanctuary-readability floor. Nothing projected may render below it.
 *
 * Pure function — unit-testable, no DOM.
 */

/** Absolute floor for projected body text, as a fraction of display height. */
export const PROJECTOR_MIN_BODY_FRACTION = 0.03;

/** Ceiling so short lines don't become absurdly huge. */
export const PROJECTOR_MAX_BODY_FRACTION = 0.12;

/** Floor for reference/label text (e.g. "John 3:16 (KJV)"), fraction of height. */
export const PROJECTOR_MIN_REF_SIZE = 0.02;

/** Count words in a text block (whitespace-delimited, ignores empties). */
export function countWords(text: string): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Compute the target projected font size in px for a given text block and
 * display height. Banded by word count, clamped to [3%, 12%] of height.
 */
export function calculateProjectorFontSize(text: string, displayHeightPx: number): number {
  const h = Number.isFinite(displayHeightPx) && displayHeightPx > 0 ? displayHeightPx : 1080;
  const words = countWords(text);
  let fraction: number;
  if (words <= 10) fraction = 0.10;
  else if (words <= 25) fraction = 0.075;
  else if (words <= 50) fraction = 0.055;
  else if (words <= 80) fraction = 0.042;
  else fraction = PROJECTOR_MIN_BODY_FRACTION;
  const clamped = Math.min(PROJECTOR_MAX_BODY_FRACTION, Math.max(PROJECTOR_MIN_BODY_FRACTION, fraction));
  return Math.round(clamped * h);
}

/**
 * The hard readability floor in px for a given display height.
 *
 * Fix-loop 2026-07-27: absolute minimum of 16px. Small SURFACES (e.g. the
 * stage display's Next pane, ~340px tall) made 3%-of-height ≈ 10px —
 * unreadable. Enforcing the px minimum here fixes stage panes without a
 * stage-specific code path; full projectors (≥720p) are unaffected since
 * 3% of 720 is already 22px.
 */
export function projectorFloorPx(displayHeightPx: number): number {
  const h = Number.isFinite(displayHeightPx) && displayHeightPx > 0 ? displayHeightPx : 1080;
  return Math.max(16, Math.round(PROJECTOR_MIN_BODY_FRACTION * h));
}
