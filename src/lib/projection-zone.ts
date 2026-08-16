/**
 * Projection Zone Customizer — data model + helpers.
 *
 * PHASE 0 FINDINGS (real PresentFlow architecture — the spec assumed
 * SwiftUI/AppKit/NSScreen/NDI-video; none of that exists here):
 *  - Projection pipeline is REACT: the projector is an Electron BrowserWindow
 *    (electron/windows/OutputWindow.ts) loading src/app/live/page.tsx, which
 *    renders src/components/live/PresentationCanvas.tsx (fixed 1920×1080 canvas
 *    scaled to the surface via CSS transform) → SlideRenderer.tsx → AutoFitText.
 *  - "Dual, real-time, identical" outputs are already solved by OutputState over
 *    BroadcastChannel + the Electron main-process relay (src/lib/broadcast.ts);
 *    /live, /stage and /livestream all consume it. NDI here is AUDIO-ONLY
 *    (native/macos PresentFlowAudioHelper) — there is no NDI video pipeline.
 *  - Font scale + aspect ratio already live on OutputState (fontScale,
 *    aspectRatio). The zone folds its fontScale multiplier into OutputState
 *    .fontScale upstream, and its RECT is applied by PresentationCanvas.
 *
 * INTEGRATION POINT: the zone is a normalized rect (+ margins) added to
 * OutputState; PresentationCanvas positions/sizes the composed slide inside that
 * rect instead of full-bleed, and publishes the zone's content-area dimensions
 * to AutoFitText via PresentationCanvasContext so text fits the zone. Themes are
 * untouched (geometry only); whisper/auto-project unaffected.
 *
 * All geometry is NORMALISED (0..1) so profiles are resolution-portable.
 */

/** The live geometry carried on OutputState + consumed by PresentationCanvas. */
export type ProjectionZone = {
  /** Content-zone rect, normalised to the output canvas (0..1). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Breathing room INSIDE the zone, normalised to the canvas (0..1). */
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  /** Font multiplier applied ON TOP of the theme/operator font size (0.5..2). */
  fontScale: number;
};

/** A named, persisted profile (e.g. "Main Hall", "Youth Room"). */
export type ProjectionZoneProfile = ProjectionZone & {
  id: string;
  name: string;
  isDefault: boolean;
  /** NSScreen-equivalent: the Electron display/preset this targets (optional). */
  targetScreenName?: string | null;
  outputResolution?: { width: number; height: number } | null;
  createdAt: string;
  updatedAt: string;
};

/** Full-canvas identity zone — behaves exactly like the pre-feature output. */
export const FULL_ZONE: ProjectionZone = {
  x: 0, y: 0, w: 1, h: 1,
  marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
  fontScale: 1,
};

/** Default profile geometry: full canvas, ~1.85% uniform margin (≈20px @1080). */
export const DEFAULT_ZONE: ProjectionZone = {
  x: 0, y: 0, w: 1, h: 1,
  marginTop: 20 / 1080, marginBottom: 20 / 1080, marginLeft: 20 / 1920, marginRight: 20 / 1920,
  fontScale: 1,
};

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);
const clampScale = (n: number) => (Number.isFinite(n) ? Math.max(0.5, Math.min(2, n)) : 1);

/** Minimum zone size (fraction of canvas) — matches the spec's 20% floor. */
export const MIN_ZONE = 0.2;

/** Coerce arbitrary input into a valid ProjectionZone (defensive on the wire). */
export function normalizeZone(z: Partial<ProjectionZone> | null | undefined): ProjectionZone {
  if (!z || typeof z !== "object") return FULL_ZONE;
  const w = Math.max(MIN_ZONE, clamp01(z.w ?? 1));
  const h = Math.max(MIN_ZONE, clamp01(z.h ?? 1));
  const x = clamp01(Math.min(z.x ?? 0, 1 - w));
  const y = clamp01(Math.min(z.y ?? 0, 1 - h));
  return {
    x, y, w, h,
    marginTop: clamp01(z.marginTop ?? 0),
    marginBottom: clamp01(z.marginBottom ?? 0),
    marginLeft: clamp01(z.marginLeft ?? 0),
    marginRight: clamp01(z.marginRight ?? 0),
    fontScale: clampScale(z.fontScale ?? 1),
  };
}

/** True when the zone is effectively the full canvas with no font change. */
export function isFullZone(z: ProjectionZone | null | undefined): boolean {
  if (!z) return true;
  return z.x === 0 && z.y === 0 && z.w === 1 && z.h === 1 &&
    z.marginTop === 0 && z.marginBottom === 0 && z.marginLeft === 0 && z.marginRight === 0 &&
    z.fontScale === 1;
}

/** Structural validator for OutputState.zone arriving over the wire. */
export function isValidZone(z: unknown): z is ProjectionZone {
  if (!z || typeof z !== "object") return false;
  const o = z as Record<string, unknown>;
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  return num(o.x) && num(o.y) && num(o.w) && num(o.h) &&
    num(o.marginTop) && num(o.marginBottom) && num(o.marginLeft) && num(o.marginRight) &&
    num(o.fontScale);
}

/**
 * Resolve a zone to pixel rects on a given canvas.
 *  - `outer`: the zone rect (the SlideRenderer / background fills this).
 *  - `inner`: the content/text area after margins (published to AutoFitText).
 */
export function resolveZoneRects(z: ProjectionZone, canvasW: number, canvasH: number) {
  const zz = normalizeZone(z);
  const outer = {
    x: Math.round(zz.x * canvasW),
    y: Math.round(zz.y * canvasH),
    w: Math.round(zz.w * canvasW),
    h: Math.round(zz.h * canvasH),
  };
  const mL = Math.round(zz.marginLeft * canvasW);
  const mR = Math.round(zz.marginRight * canvasW);
  const mT = Math.round(zz.marginTop * canvasH);
  const mB = Math.round(zz.marginBottom * canvasH);
  const inner = {
    x: outer.x + mL,
    y: outer.y + mT,
    w: Math.max(1, outer.w - mL - mR),
    h: Math.max(1, outer.h - mT - mB),
  };
  return { outer, inner };
}

/** Strip a profile down to the wire zone carried on OutputState. */
export function profileToZone(p: ProjectionZoneProfile): ProjectionZone {
  return normalizeZone(p);
}
