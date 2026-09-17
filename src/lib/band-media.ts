// Pure geometry for image/video rendered inside the church lower-third band.
// All maths is in the fixed 1920×1080 PresentationCanvas space so the operator
// preview and /live /stage /livestream render identically.

export const CANVAS_W = 1920;
export const CANVAS_H = 1080;
/** Shared with the scripture text band (themeBackgroundStyle fallback). */
export const BAND_FALLBACK_BG = "#0b0b0b";
/**
 * DEFAULT lower-third band colour (used only when a church never set its own).
 * A soft charcoal (not pure black) so, at the default 0.72 opacity, the band is
 * still visible on a black screen and reads as a subtle bar over pictures.
 * Churches that saved an explicit colour keep it (2026-09-17 owner decision).
 */
export const BAND_DEFAULT_COLOR = "#1c1c22";
/** Faint top highlight so the default band reads even on pure black. */
export const BAND_DEFAULT_EDGE = "inset 0 2px 0 rgba(255,255,255,0.16)";
/** Edge style for a band paint: only the untouched default colour gets the highlight. */
export function bandEdgeShadow(color?: string, color2?: string): string | undefined {
  return color && color.toLowerCase() === BAND_DEFAULT_COLOR && !color2 ? BAND_DEFAULT_EDGE : undefined;
}
/** Media is never upscaled beyond this multiple of its natural size. */
export const MEDIA_MAX_UPSCALE = 1.5;
/** Aspect (w/h) below which media counts as portrait/narrow. */
export const NARROW_ASPECT = 0.8;

export interface BandMediaBox {
  /** % of canvas */
  topPct: number;
  heightPct: number;
  leftPct: number;
  widthPct: number;
}

/** The inner media box inside a band: same 6%/88% horizontal inset and vertical pad as the text band. */
export function bandMediaBox(topPct: number, heightPct: number): BandMediaBox {
  const pad = heightPct * 0.06;
  return { topPct: topPct + pad, heightPct: Math.max(1, heightPct - pad * 2), leftPct: 6, widthPct: 88 };
}

/**
 * Size (as % of the box) of media with natural size natW×natH placed "contain"
 * in a box of boxW×boxH canvas px, centred, never upscaled past maxUpscale×.
 * Returns full box when natural dims are unknown.
 */
export function fitMediaInBox(
  natW: number, natH: number, boxW: number, boxH: number, maxUpscale = MEDIA_MAX_UPSCALE,
): { wPct: number; hPct: number } {
  if (!(natW > 0) || !(natH > 0) || !(boxW > 0) || !(boxH > 0)) return { wPct: 100, hPct: 100 };
  const scale = Math.min(boxW / natW, boxH / natH, maxUpscale);
  return { wPct: ((natW * scale) / boxW) * 100, hPct: ((natH * scale) / boxH) * 100 };
}

export function isNarrowMedia(natW: number, natH: number): boolean {
  return natW > 0 && natH > 0 && natW / natH < NARROW_ASPECT;
}

/** Caption font size in canvas px (scales with the band like the scripture reference). */
export function bandCaptionPx(heightPct: number, fontScale = 1): number {
  return Math.max(16, Math.round((heightPct / 100) * CANVAS_H * 0.26 * (fontScale > 0 ? fontScale : 1)));
}
