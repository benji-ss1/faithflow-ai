/**
 * Pure geometry/identity helpers for baking a saved media frame (see mediaFrameBake.ts).
 * Kept free of any server/DOM imports so they are unit-testable in node.
 */
import { frameBox, type MediaFrame } from "./mediaFrame";

/** blur-fill / blurred-background look (must match SlideObjectsLayer). */
export const BAKE_BLUR_FILTER = "blur(34px) brightness(0.62) saturate(1.08)";

/** A frame that is just "the whole image, cover, centred" needs no baking. */
export function isTrivialFrame(f: MediaFrame): boolean {
  return f.fit === "cover" && f.posX === 50 && f.posY === 50 && f.zoom === 1
    && !f.blurFill && f.bgMode !== "background" && frameBox(f) === null;
}

/** Stable identity of a frame: a re-edit changes it, so a stale bake is never reused. */
export function frameHash(f: MediaFrame): string {
  return JSON.stringify(Object.keys(f).sort().map((k) => [k, (f as Record<string, unknown>)[k]]));
}

/** Where the image is drawn inside its box for object-fit + object-position (CSS semantics). */
export function fitRect(
  iw: number, ih: number, x: number, y: number, w: number, h: number,
  fit: "contain" | "cover" | "fill", posX: number, posY: number,
): { dx: number; dy: number; dw: number; dh: number } {
  let dw = w, dh = h;
  if (fit === "contain") { const s = Math.min(w / iw, h / ih); dw = iw * s; dh = ih * s; }
  else if (fit === "cover") { const s = Math.max(w / iw, h / ih); dw = iw * s; dh = ih * s; }
  return { dx: x + (w - dw) * (posX / 100), dy: y + (h - dh) * (posY / 100), dw, dh };
}

/** CSS linear-gradient(angle) end points for a w×h box (canvas has no angle shorthand). */
export function gradientLine(angleDeg: number, x: number, y: number, w: number, h: number) {
  const a = (angleDeg * Math.PI) / 180;
  const sx = Math.sin(a), sy = -Math.cos(a);
  const len = Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a));
  const cx = x + w / 2, cy = y + h / 2;
  return { x0: cx - (sx * len) / 2, y0: cy - (sy * len) / 2, x1: cx + (sx * len) / 2, y1: cy + (sy * len) / 2 };
}
