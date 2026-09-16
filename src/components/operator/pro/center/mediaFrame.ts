import { CANVAS_W, CANVAS_H, newObjectId, type SlideObject, type ImageObject, type ShapeObject } from "@/lib/slide-objects";

// Per-asset media framing persistence (crop / pan / zoom / fit).
//
// The media image editor lets the operator frame an image (Fit/Fill/Stretch +
// pan + zoom). Without this, that framing is ephemeral — the next click projects
// the image un-framed. Here we persist the framing PER ASSET so a saved image
// projects correctly framed straight from a single click, no editor needed.
//
// Mirrors src/components/operator/scripture/scriptureStyle.ts: localStorage,
// SSR-guarded, try/catch-safe, versioned key. Church-scoped per CLAUDE.md rule 5.
// A DB-backed version (media_assets.frameJson) is the production upgrade path;
// both key on (churchId, assetId) so migration is clean.

export type MediaFrame = {
  fit: "contain" | "cover" | "fill";
  posX: number; // 0-100 (object-position %)
  posY: number; // 0-100
  zoom: number; // 1-8 (transform scale past the fit baseline)
  // Blur-fill: when fit is "contain" (letterboxed), fill the bars with a blurred
  // cover copy of the same image instead of black — great for portrait flyers.
  blurFill?: boolean;
  // Logo-over-background mode (all optional — absent = the default black matte,
  // so every previously-saved frame keeps working unchanged).
  bgMode?: "matte" | "background";       // "matte" = full-screen image on black (default)
  bgKind?: "solid" | "theme" | "gradient" | "blur"; // background source when bgMode==="background" ("blur" = a screen-filling blurred copy of the image)
  bgSolid?: string;                       // solid colour (hex/rgb)
  gradFrom?: string;                      // gradient start
  gradTo?: string;                        // gradient end
  gradAngle?: number;                     // 0-360
  logoSizePct?: number;                   // 10-100 — the logo box as % of the canvas
  logoPosX?: number;                      // 0-100 — logo box CENTRE x
  logoPosY?: number;                      // 0-100 — logo box CENTRE y
  // The image BOX on the 1920x1080 canvas (2026-09-16). Optional + backward
  // compatible: absent = the pre-existing behaviour (full canvas in matte mode,
  // logoSizePct/logoPos-derived square-% box in background mode). Present =
  // the exact crop/resize the operator dragged with the handles.
  boxX?: number;
  boxY?: number;
  boxW?: number;
  boxH?: number;
};

/** Event fired (on window) whenever a saved frame is written or cleared, so any
 *  list/grid that renders frame-aware thumbnails can recompute. */
export const MEDIA_FRAME_CHANGED_EVENT = "presentflow:media-frame-changed";

function emitFrameChanged(churchId: string | undefined, assetId: string) {
  try {
    window.dispatchEvent(new CustomEvent(MEDIA_FRAME_CHANGED_EVENT, { detail: { churchId, assetId } }));
  } catch { /* non-fatal */ }
}

/** The saved box, if a complete valid one exists (else null → legacy geometry). */
export function frameBox(frame: MediaFrame): { x: number; y: number; w: number; h: number } | null {
  const { boxX, boxY, boxW, boxH } = frame;
  if ([boxX, boxY, boxW, boxH].every((n) => typeof n === "number" && Number.isFinite(n)) && (boxW as number) >= 1 && (boxH as number) >= 1) {
    return { x: Math.round(boxX as number), y: Math.round(boxY as number), w: Math.round(boxW as number), h: Math.round(boxH as number) };
  }
  return null;
}

const key = (churchId: string | undefined, assetId: string) =>
  `pf.mediaFrame.v1.${churchId || "default"}.${assetId}`;

export function loadMediaFrame(churchId: string | undefined, assetId: string): MediaFrame | null {
  if (typeof window === "undefined") return null;
  try {
    // Reads ONLY this church's key. A frame under the shared "default" key is never
    // adopted by a church (a device can switch churches → cross-church leak), and
    // the editor won't save until the church id has loaded, so none are written.
    const raw = window.localStorage.getItem(key(churchId, assetId));
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<MediaFrame>;
    const fit = p.fit === "contain" || p.fit === "cover" || p.fit === "fill" ? p.fit : "cover";
    const clamp = (n: unknown, lo: number, hi: number, dflt: number) =>
      typeof n === "number" && Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
    // A well-formed CSS colour (hex or rgb/rgba) — mirror broadcast.ts isValidColor
    // so a stored colour can't smuggle CSS. Undefined stays undefined (optional).
    const COLOR = /^(?:#[0-9a-fA-F]{3,8}|rgba?\(\s*\d+(?:\s*,\s*\d+){2}\s*(?:,\s*(?:0|1|0?\.\d+))?\s*\))$/;
    const colorOr = (c: unknown, dflt: string | undefined) =>
      typeof c === "string" && c.length <= 32 && COLOR.test(c.trim()) ? c : dflt;
    const out: MediaFrame = {
      fit,
      posX: clamp(p.posX, 0, 100, 50),
      posY: clamp(p.posY, 0, 100, 50),
      zoom: clamp(p.zoom, 1, 8, 1),
    };
    if (p.blurFill === true) out.blurFill = true;
    // Background-mode fields are all optional; only populate them when a valid
    // saved value exists so absence cleanly defaults to matte.
    if (p.bgMode === "background") out.bgMode = "background";
    else if (p.bgMode === "matte") out.bgMode = "matte";
    if (p.bgKind === "solid" || p.bgKind === "theme" || p.bgKind === "gradient" || p.bgKind === "blur") out.bgKind = p.bgKind;
    const solid = colorOr(p.bgSolid, undefined); if (solid) out.bgSolid = solid;
    const gFrom = colorOr(p.gradFrom, undefined); if (gFrom) out.gradFrom = gFrom;
    const gTo = colorOr(p.gradTo, undefined); if (gTo) out.gradTo = gTo;
    if (typeof p.gradAngle === "number" && Number.isFinite(p.gradAngle)) out.gradAngle = clamp(p.gradAngle, 0, 360, 135);
    if (typeof p.logoSizePct === "number" && Number.isFinite(p.logoSizePct)) out.logoSizePct = clamp(p.logoSizePct, 10, 100, 60);
    if (typeof p.logoPosX === "number" && Number.isFinite(p.logoPosX)) out.logoPosX = clamp(p.logoPosX, 0, 100, 50);
    if (typeof p.logoPosY === "number" && Number.isFinite(p.logoPosY)) out.logoPosY = clamp(p.logoPosY, 0, 100, 50);
    // Box: only kept when ALL four are valid numbers (a partial box is ignored →
    // legacy geometry). Generous band so a box dragged slightly off-canvas survives.
    const bx = p.boxX, by = p.boxY, bw = p.boxW, bh = p.boxH;
    if ([bx, by, bw, bh].every((n) => typeof n === "number" && Number.isFinite(n))) {
      // Same band the projector wire accepts (broadcast.ts isCanvasCoord).
      out.boxX = clamp(bx, -CANVAS_W, CANVAS_W * 2, 0);
      out.boxY = clamp(by, -CANVAS_W, CANVAS_W * 2, 0);
      out.boxW = clamp(bw, 1, CANVAS_W * 2, CANVAS_W);
      out.boxH = clamp(bh, 1, CANVAS_W * 2, CANVAS_H);
    }
    return out;
  } catch {
    return null;
  }
}

export function saveMediaFrame(churchId: string | undefined, assetId: string, frame: MediaFrame): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key(churchId, assetId), JSON.stringify(frame));
  } catch {
    /* quota / disabled storage — non-fatal, framing just won't persist */
    return;
  }
  emitFrameChanged(churchId, assetId);
}

export function clearMediaFrame(churchId: string | undefined, assetId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key(churchId, assetId));
  } catch {
    /* non-fatal */
    return;
  }
  emitFrameChanged(churchId, assetId);
}

/**
 * Build the projectable slide ({ bgColor, objects }) for an image asset given a
 * saved frame. This is the SINGLE source of truth for what a saved frame
 * projects to, shared by click-to-project (MediaBrowser.toSlide) so it matches
 * exactly what the editor's "Save & Show" produces — matte OR logo-on-background
 * (solid / theme / gradient). Without this, a saved background-mode frame would
 * silently project as a black-matte full-screen image.
 */
export function buildMediaFrameSlide(frame: MediaFrame, url: string): { bgColor?: string; objects: SlideObject[] } {
  if (frame.bgMode === "background") {
    const size = frame.logoSizePct ?? 60;
    const cx = frame.logoPosX ?? 50, cy = frame.logoPosY ?? 50;
    const box = frameBox(frame);
    const w = box ? box.w : Math.round(CANVAS_W * size / 100), h = box ? box.h : Math.round(CANVAS_H * size / 100);
    const x = box ? box.x : Math.round(CANVAS_W * cx / 100 - w / 2), y = box ? box.y : Math.round(CANVAS_H * cy / 100 - h / 2);
    const logo: ImageObject = { id: newObjectId(), kind: "image", x, y, w, h, url, fit: "contain", posX: 50, posY: 50, zoom: 1 };
    const kind = frame.bgKind ?? "solid";
    if (kind === "gradient") {
      const from = frame.gradFrom ?? "#1e293b";
      const shape: ShapeObject = { id: newObjectId(), kind: "shape", x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, shape: "rect", fill: from, fill2: frame.gradTo ?? "#0b1220", fillAngle: frame.gradAngle ?? 135 };
      return { bgColor: from, objects: [shape, logo] }; // gradFrom as opaque backstop under the shape
    }
    if (kind === "blur") {
      // A full-screen blurred copy of the image behind the sharp logo (Spotify-style).
      const blurBg: ImageObject = { id: newObjectId(), kind: "image", x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, url, fit: "cover", posX: 50, posY: 50, zoom: 1, blur: true };
      return { bgColor: "#000000", objects: [blurBg, logo] };
    }
    if (kind === "theme") return { bgColor: undefined, objects: [logo] }; // theme shows through
    return { bgColor: frame.bgSolid ?? "#0b1220", objects: [logo] };
  }
  // Matte (default): full-canvas image on black, framed by fit/pan/zoom.
  // blurFill carries through so a saved blurred flyer projects blurred on a
  // single click, everywhere (media library, playlist, editor) — 1:1 with live.
  const mbox = frameBox(frame) ?? { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H };
  const logo: ImageObject = {
    id: newObjectId(), kind: "image", x: mbox.x, y: mbox.y, w: mbox.w, h: mbox.h,
    url, fit: frame.fit, posX: frame.posX, posY: frame.posY, zoom: frame.zoom,
    ...(frame.blurFill && frame.fit === "contain" ? { blurFill: true } : {}),
  };
  return { bgColor: "#000000", objects: [logo] };
}

/**
 * PP7 layers: a Media-bin/library click normally puts media on the Media LAYER
 * (a plain full-screen background — no framing). A SAVED frame (crop / logo on
 * background) can only project as an object slide, so when the image is framed
 * and no WORDS are live (nothing to keep on screen), send the framed slide
 * instead. With words live the Media-layer behaviour is unchanged (words stay).
 */
export function shouldSendFramedSlide(
  hasFrame: boolean,
  isVideo: boolean,
  live: { kind: string; text?: string } | null | undefined,
): boolean {
  if (!hasFrame || isVideo) return false;
  const wordsLive = !!live && live.kind === "text" && typeof live.text === "string" && live.text.trim().length > 0;
  return !wordsLive;
}
