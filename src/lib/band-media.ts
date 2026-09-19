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
/**
 * True for a slide the renderer lays out in the fixed 1920x1080 canvas's lower-third band:
 * a text slide carrying `scriptureLayout: "lowerThird"` (verses AND songs the church
 * default bands) or an image/video with a per-slide `layout: "third"`. The band branches
 * size the reference / caption in CANVAS pixels, so an operator card that renders them
 * outside a PresentationCanvas (ThemedSlideCard) must scale the canvas down or they come
 * out several times too big and overlap the verse (2026-09-19 owner report).
 */
export function isBandSlide(slide: { kind: string; scriptureLayout?: string; layout?: string }): boolean {
  if (slide.kind === "text") return slide.scriptureLayout === "lowerThird";
  if (slide.kind === "image" || slide.kind === "video") return slide.layout === "third";
  return false;
}
/** Reference-line size multiplier for a lower-third scripture band (1 when absent/invalid). */
export function refScaleOf(v: number | undefined): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.max(0.25, Math.min(4, v)) : 1;
}
/** Text-area width (% of canvas) of a lower-third scripture band; 88 = the original 6% side margins. */
export function textWidthOf(v: number | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(40, Math.min(100, v)) : 88;
}
/**
 * The lower-third verse's LOCKED size, in canvas px (2026-09-19 owner report: "the text
 * does not persist … if you call one verse a hundred verses the sizing must persist").
 *
 * It is derived from the BAND GEOMETRY and the operator's Verse size — never from the
 * verse itself — so every verse in a chapter renders at the same size instead of each
 * one auto-fitting to its own length (short verse huge, long verse tiny). A verse that
 * genuinely cannot fit still shrinks (the caller passes this as the fit CEILING, so
 * shrink-to-fit is unchanged and nothing is ever clipped); it just can never grow past
 * the size that was set.
 *
 * Calibrated against the pre-change output: at the default 30% band this is ~71px, which
 * is what a typical verse already fitted at — so churches see consistency, not a jump.
 * The factor is exactly 2x the reference line's (0.11), so Verse size 50% renders the
 * verse at precisely the reference's size and below that it goes smaller still.
 */
export const BAND_VERSE_PX_FACTOR = 0.22;
export function bandVersePx(bandHeightPct: number, fontScale?: number, globalScale?: number): number {
  const h = Number.isFinite(bandHeightPct) && bandHeightPct > 0 ? bandHeightPct : 30;
  const f = Number.isFinite(fontScale) && (fontScale as number) > 0 ? (fontScale as number) : 1;
  const g = Number.isFinite(globalScale) && (globalScale as number) > 0 ? (globalScale as number) : 1;
  return Math.max(8, Math.round((h / 100) * 1080 * BAND_VERSE_PX_FACTOR * f * g));
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

/** Old (pre-0.1.445) band default. Saved designs keep it; we only HINT. */
export const BAND_OLD_DEFAULT_COLOR = "#000000";

/** Full-screen (non-band) video: always fill the output box; fit decides crop/letterbox/stretch. */
export function videoObjectFit(fit?: string): "contain" | "cover" | "fill" {
  return fit === "cover" ? "cover" : fit === "fill" ? "fill" : "contain";
}

/** Show the "more visible band" hint only for a saved exact old-black solid/gradient band, not dismissed. */
export function shouldShowBandHint(band: { mode?: string; color?: string } | null | undefined, dismissed: boolean): boolean {
  if (dismissed || !band || band.mode === "none") return false;
  return (band.color ?? "").trim().toLowerCase() === BAND_OLD_DEFAULT_COLOR;
}

export const bandHintKey = (churchId?: string) => `presentflow.bandHint.dismissed.${churchId || "local"}`;
