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
  // Logo-over-background mode (all optional — absent = the default black matte,
  // so every previously-saved frame keeps working unchanged).
  bgMode?: "matte" | "background";       // "matte" = full-screen image on black (default)
  bgKind?: "solid" | "theme" | "gradient"; // background source when bgMode==="background"
  bgSolid?: string;                       // solid colour (hex/rgb)
  gradFrom?: string;                      // gradient start
  gradTo?: string;                        // gradient end
  gradAngle?: number;                     // 0-360
  logoSizePct?: number;                   // 10-100 — the logo box as % of the canvas
  logoPosX?: number;                      // 0-100 — logo box CENTRE x
  logoPosY?: number;                      // 0-100 — logo box CENTRE y
};

const key = (churchId: string | undefined, assetId: string) =>
  `pf.mediaFrame.v1.${churchId || "default"}.${assetId}`;

export function loadMediaFrame(churchId: string | undefined, assetId: string): MediaFrame | null {
  if (typeof window === "undefined") return null;
  try {
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
    // Background-mode fields are all optional; only populate them when a valid
    // saved value exists so absence cleanly defaults to matte.
    if (p.bgMode === "background") out.bgMode = "background";
    else if (p.bgMode === "matte") out.bgMode = "matte";
    if (p.bgKind === "solid" || p.bgKind === "theme" || p.bgKind === "gradient") out.bgKind = p.bgKind;
    const solid = colorOr(p.bgSolid, undefined); if (solid) out.bgSolid = solid;
    const gFrom = colorOr(p.gradFrom, undefined); if (gFrom) out.gradFrom = gFrom;
    const gTo = colorOr(p.gradTo, undefined); if (gTo) out.gradTo = gTo;
    if (typeof p.gradAngle === "number" && Number.isFinite(p.gradAngle)) out.gradAngle = clamp(p.gradAngle, 0, 360, 135);
    if (typeof p.logoSizePct === "number" && Number.isFinite(p.logoSizePct)) out.logoSizePct = clamp(p.logoSizePct, 10, 100, 60);
    if (typeof p.logoPosX === "number" && Number.isFinite(p.logoPosX)) out.logoPosX = clamp(p.logoPosX, 0, 100, 50);
    if (typeof p.logoPosY === "number" && Number.isFinite(p.logoPosY)) out.logoPosY = clamp(p.logoPosY, 0, 100, 50);
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
  }
}

export function clearMediaFrame(churchId: string | undefined, assetId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key(churchId, assetId));
  } catch {
    /* non-fatal */
  }
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
    const w = Math.round(CANVAS_W * size / 100), h = Math.round(CANVAS_H * size / 100);
    const x = Math.round(CANVAS_W * cx / 100 - w / 2), y = Math.round(CANVAS_H * cy / 100 - h / 2);
    const logo: ImageObject = { id: newObjectId(), kind: "image", x, y, w, h, url, fit: "contain", posX: 50, posY: 50, zoom: 1 };
    const kind = frame.bgKind ?? "solid";
    if (kind === "gradient") {
      const from = frame.gradFrom ?? "#1e293b";
      const shape: ShapeObject = { id: newObjectId(), kind: "shape", x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, shape: "rect", fill: from, fill2: frame.gradTo ?? "#0b1220", fillAngle: frame.gradAngle ?? 135 };
      return { bgColor: from, objects: [shape, logo] }; // gradFrom as opaque backstop under the shape
    }
    if (kind === "theme") return { bgColor: undefined, objects: [logo] }; // theme shows through
    return { bgColor: frame.bgSolid ?? "#0b1220", objects: [logo] };
  }
  // Matte (default): full-canvas image on black, framed by fit/pan/zoom.
  const logo: ImageObject = { id: newObjectId(), kind: "image", x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, url, fit: frame.fit, posX: frame.posX, posY: frame.posY, zoom: frame.zoom };
  return { bgColor: "#000000", objects: [logo] };
}
