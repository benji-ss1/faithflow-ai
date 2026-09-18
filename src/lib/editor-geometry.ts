// Theme/slide editor geometry helpers — PURE, no React, no DOM.
//
// These back the editor "furniture" (status bar X/Y/W/H, canvas zoom, size
// lock, flip) added for ProPresenter parity. Everything here operates on the
// 1920x1080 virtual canvas space that `slide-objects.ts` already uses, so no
// new coordinate system and no data-model invention.
//
// Nothing in this file is read by the projector renderers — it is editor-only
// maths, except `flipTransform`, which both the editor canvas and the live
// renderer call so the editor stays WYSIWYG. `flipTransform` returns
// `undefined` for an object with no flip flags, which is every object that
// exists today, so existing themes and slides render byte-identically.

import { CANVAS_W, CANVAS_H } from "./slide-objects";

export type Rect = { x: number; y: number; w: number; h: number };

/** Smallest width/height the editor lets an object have (matches SlideCanvas). */
export const MIN_OBJECT_SIZE = 20;

// ---------- Status bar ------------------------------------------------------

/**
 * The four numbers the status bar shows for the selected object. Canvas units
 * (1920x1080 virtual px), origin top-left — the same units the X/Y/W/H inputs
 * in the Design panel already use, so the two can never disagree.
 *
 * ProPresenter shows the same four values in its editor status bar; we round to
 * whole units because sub-pixel drag deltas are noise to an operator.
 */
export function formatRectStatus(r: Rect | null): { x: string; y: string; w: string; h: string } {
  if (!r) return { x: "—", y: "—", w: "—", h: "—" };
  return {
    x: String(Math.round(r.x)),
    y: String(Math.round(r.y)),
    w: String(Math.round(r.w)),
    h: String(Math.round(r.h)),
  };
}

/** Bounding box of several objects (used when a group is selected). */
export function boundingRect(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ---------- Zoom ------------------------------------------------------------

/**
 * Zoom is EDITOR-ONLY view state. `null` means "Fit" — the canvas sizes itself
 * to the available space exactly as it always has, which is the default and the
 * pre-existing behaviour. A number is a multiplier of that fitted size.
 */
export type EditorZoom = number | null;

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;
/** The steps the +/- buttons walk through. 1 is always included. */
export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4] as const;

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

/** Next step up/down from the current zoom. `null` (Fit) counts as 1. */
export function stepZoom(current: EditorZoom, dir: 1 | -1): number {
  const cur = current ?? 1;
  if (dir === 1) {
    for (const s of ZOOM_STEPS) if (s > cur + 1e-6) return s;
    return ZOOM_MAX;
  }
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) if (ZOOM_STEPS[i] < cur - 1e-6) return ZOOM_STEPS[i];
  return ZOOM_MIN;
}

/** Label for the zoom readout. Fit shows as "Fit", not a bogus percentage. */
export function zoomLabel(z: EditorZoom): string {
  return z === null ? "Fit" : `${Math.round(z * 100)}%`;
}

// ---------- Size lock (aspect ratio) ---------------------------------------

/**
 * Constrain a resize to the object's ORIGINAL aspect ratio.
 *
 * `start` is the rect when the drag began (the ratio source — using the live
 * rect would let rounding drift the ratio over a long drag). `next` is what the
 * unconstrained resize produced. `handle` says which edges moved, so we know
 * which side to trust and which edge must stay pinned:
 *   - a side handle (n/s/e/w) drives from the one dimension it changes;
 *   - a corner handle drives from whichever dimension moved MORE, so the shape
 *     follows the pointer instead of snapping to one axis.
 * Edges opposite the grabbed handle never move, matching the unconstrained path.
 */
const RESIZE_HANDLES = new Set(["nw", "n", "ne", "e", "se", "s", "sw", "w"]);

export function constrainAspect(start: Rect, next: Rect, handle: string): Rect {
  const ratio = start.h === 0 ? 1 : start.w / start.h;
  if (!Number.isFinite(ratio) || ratio <= 0) return next;

  // Only the eight resize handles constrain. Guarding by an explicit set (not a
  // substring test) matters: "move" CONTAINS "e", which would otherwise be read
  // as an east-edge drag and resize an object the operator is only dragging.
  if (!RESIZE_HANDLES.has(handle)) return next;
  const west = handle.includes("w");
  const north = handle.includes("n");
  const horizontal = handle.includes("e") || west;
  const vertical = handle.includes("n") || handle.includes("s");

  let w = next.w;
  let h = next.h;
  if (horizontal && vertical) {
    // Corner: whichever axis the pointer moved further on wins.
    const dw = Math.abs(next.w - start.w);
    const dh = Math.abs(next.h - start.h);
    if (dw >= dh) h = w / ratio;
    else w = h * ratio;
  } else if (horizontal) {
    h = w / ratio;
  } else if (vertical) {
    w = h * ratio;
  } else {
    return next;
  }

  w = Math.max(MIN_OBJECT_SIZE, w);
  h = Math.max(MIN_OBJECT_SIZE, h);
  // Re-derive so the floor on one axis can't break the ratio.
  if (horizontal && !vertical) h = Math.max(MIN_OBJECT_SIZE, w / ratio);
  if (vertical && !horizontal) w = Math.max(MIN_OBJECT_SIZE, h * ratio);

  // Pin the edge opposite the handle.
  const x = west ? start.x + start.w - w : next.x;
  const y = north ? start.y + start.h - h : next.y;
  return { x, y, w, h };
}

/**
 * Typing a new W (or H) in the Design panel while size lock is on should move
 * the other one with it. Returns the full patch to apply.
 */
export function lockedSizePatch(
  current: Rect,
  field: "w" | "h",
  value: number,
): { w: number; h: number } {
  const ratio = current.h === 0 ? 1 : current.w / current.h;
  const v = Math.max(MIN_OBJECT_SIZE, Math.round(value));
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return field === "w" ? { w: v, h: current.h } : { w: current.w, h: v };
  }
  if (field === "w") return { w: v, h: Math.max(MIN_OBJECT_SIZE, Math.round(v / ratio)) };
  return { w: Math.max(MIN_OBJECT_SIZE, Math.round(v * ratio)), h: v };
}

// ---------- Flip ------------------------------------------------------------

/**
 * CSS value for the INDEPENDENT `scale` property (not the `transform`
 * shorthand) so a flip composes with the existing independent `rotate` and with
 * the entrance-animation `transform` instead of fighting them — exactly the
 * reasoning already documented for `rotate` in SlideObjectsLayer.
 *
 * Returns `undefined` when neither flag is set. EVERY object in every existing
 * theme and slide is in that state, so this is a provable no-op for saved
 * content (parity-tested).
 */
export function flipTransform(o: { flipH?: boolean; flipV?: boolean }): string | undefined {
  if (!o.flipH && !o.flipV) return undefined;
  return `${o.flipH ? -1 : 1} ${o.flipV ? -1 : 1}`;
}

// ---------- Nudge / canvas bounds -------------------------------------------

/**
 * Keep an object at least partly on the canvas after a nudge or a drag so it
 * can never be lost off-screen. Deliberately permissive (an object may hang off
 * an edge — PP7 allows that, and lower-thirds rely on it); it only guarantees
 * MIN_OBJECT_SIZE of the object stays reachable.
 */
export function keepOnCanvas(r: Rect): Rect {
  const x = Math.min(CANVAS_W - MIN_OBJECT_SIZE, Math.max(MIN_OBJECT_SIZE - r.w, r.x));
  const y = Math.min(CANVAS_H - MIN_OBJECT_SIZE, Math.max(MIN_OBJECT_SIZE - r.h, r.y));
  return { ...r, x, y };
}
