/**
 * THE canvas coordinate contract — one logical slide space, one set of
 * conversions, used by BOTH the editor and every output surface.
 *
 * Why this module exists (2026-09-22 audit):
 *   - `1920` / `1080` were declared THREE times with no cross-import
 *     (slide-objects.ts, broadcast.ts, PresentationCanvas.tsx). Nothing stopped
 *     them drifting.
 *   - The logical->percent conversion `(v / CANVAS_W) * 100` was hand-copied
 *     ~28 times across SlideObjectsLayer.tsx and SlideCanvas.tsx, with a comment
 *     ("Mirrors the editor's canvas math EXACTLY") as the only contract. It had
 *     ALREADY drifted: the projector scaled `letterSpacing` by the font scale
 *     and the editor did not, and the editor applied NO 1.6 clamp.
 *
 * Model: every slide element is stored in ABSOLUTE LOGICAL PIXELS on a fixed
 * 1920x1080 canvas (top-left origin, floats preserved — see slide-objects.ts).
 * Nothing stores editor-screen pixels. A surface renders by converting logical
 * units to PERCENT of the canvas, and the canvas itself is CSS-transform-scaled
 * to the physical surface (PresentationCanvas). That is what makes preview and
 * projector agree at any size.
 *
 * Pure, dependency-free and client-safe: no React, no DOM, no storage.
 */

/** The canonical logical slide canvas. Every other declaration derives from these. */
export const SLIDE_W = 1920;
export const SLIDE_H = 1080;

/**
 * Positioned slide objects are fixed-size boxes with `overflow:hidden` and are
 * NOT auto-fitted, so the operator's wider 0.3-2.5 font range is clamped here
 * before it reaches object text — otherwise a large multiplier silently clips
 * designed text. The projector has always applied this; the EDITOR did not,
 * which is why designed text previewed larger than it projected.
 */
export const OBJECT_FONT_SCALE_MAX = 1.6;

/** Clamp a font multiplier to what positioned object text may actually use. */
export function objectFontScale(scale: number | undefined): number {
  return Number.isFinite(scale) && (scale as number) > 0 ? Math.min(scale as number, OBJECT_FONT_SCALE_MAX) : 1;
}

/** Logical X (or width) -> percent of the canvas width. */
export function pctX(v: number): number { return (v / SLIDE_W) * 100; }
/** Logical Y (or height) -> percent of the canvas height. */
export function pctY(v: number): number { return (v / SLIDE_H) * 100; }

/**
 * A logical length -> a `cqh` value (percent of the query container's HEIGHT).
 * Font size, line height, letter spacing and stroke width all resolve against
 * the canvas container, so they scale with the output surface automatically.
 */
export function cqh(px: number, scale = 1): number { return ((px * scale) / SLIDE_H) * 100; }
/** A logical length -> a `cqw` value (percent of the query container's WIDTH). */
export function cqw(px: number, scale = 1): number { return ((px * scale) / SLIDE_W) * 100; }

/** The scale factors that take EDITOR-screen pixels to LOGICAL canvas units. */
export type CanvasScale = { scaleX: number; scaleY: number };

/**
 * Screen rect -> logical scale, or NULL when the rect cannot be used.
 *
 * A zero/NaN-sized rect (collapsed flex parent, hidden tab, measured before
 * layout) would otherwise produce Infinity and write NaN geometry into the
 * slide — which renders broken locally and is then SILENTLY rejected by
 * `isValidSlideObject` on publish. Callers must treat null as "don't start".
 */
export function canvasScaleFor(rect: { width: number; height: number } | null | undefined): CanvasScale | null {
  if (!rect) return null;
  const { width, height } = rect;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { scaleX: SLIDE_W / width, scaleY: SLIDE_H / height };
}

/** Editor-screen delta -> logical delta. Used by drag/resize (snapshot + delta). */
export function editorToLogical(dx: number, dy: number, s: CanvasScale): { dx: number; dy: number } {
  return { dx: dx * s.scaleX, dy: dy * s.scaleY };
}

/** Logical delta -> editor-screen delta (the exact inverse of editorToLogical). */
export function logicalToEditor(dx: number, dy: number, s: CanvasScale): { dx: number; dy: number } {
  return { dx: dx / s.scaleX, dy: dy / s.scaleY };
}
