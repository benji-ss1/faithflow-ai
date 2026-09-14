/**
 * OBS overlay LOWER-THIRD helpers (2026-09-06 field request, IMG_5489/5490).
 *
 * The OBS Browser Source overlay (`/livestream?bg=transparent`) rendered song
 * lyrics FULL-SCREEN over the camera. Churches want a broadcast-style LOWER
 * THIRD instead — as an OPTION set in the OBS setup card, DECOUPLED from the
 * projector (the projector/operator stay full-screen; only OBS goes lower-third).
 *
 * Shared contract between the setup card (mints the OBS URL + live-publishes the
 * config) and `/livestream` (renders it): a compact geometry + STYLE + OPACITY
 * config, plus a pure `overlayBandSlide()` that wraps whatever slide is live into
 * a `scriptureLayout:"lowerThird"` slide so it renders through SlideRenderer's
 * PROVEN band branch — auto-fit, church fonts via themeTextStyle(appearance), no
 * clipping, movable geometry, 6 band looks (incl. "theme" = the projector's exact
 * colours). Purely overlay-side: it never changes the OutputState the projector
 * renders (the projector never reads the OBS band config).
 *
 * Pure + deterministic (no window/DOM) so it is unit-testable and safe to import
 * on both the card and the render page.
 */
import type { SlidePayload, ScriptureBandWire } from "./broadcast";

// The band background looks (user: "one like this and 4 other options … theme
// colours we use on the projector"). "theme" mirrors the church's real theme.
export type ObsBandStyle = "grey" | "black" | "clear" | "gradient" | "frost" | "theme";
export const OBS_BAND_STYLES: ObsBandStyle[] = ["grey", "black", "clear", "gradient", "frost", "theme"];

export const OBS_BAND_STYLE_META: Record<ObsBandStyle, { label: string; hint: string }> = {
  grey:     { label: "Soft grey",     hint: "Semi-transparent grey bar (broadcast default)" },
  black:    { label: "Solid black",   hint: "Darker bar for maximum legibility" },
  clear:    { label: "Clear",         hint: "No bar — just the words (most see-through)" },
  gradient: { label: "Gradient fade", hint: "Soft dark fade behind the words" },
  frost:    { label: "Frosted light", hint: "Light bar with dark words" },
  theme:    { label: "Theme colours", hint: "Your projector's exact background + text colour" },
};

// The church's real theme colours (mirrored from the OutputState appearance on
// the render page) — used ONLY by the "theme" style.
export type ObsThemeColors = { textColor?: string; bgColor?: string; bgColor2?: string; bgAngle?: number };

export type ObsBandConfig = {
  topPct: number;    // band top edge, % of the 1080 canvas
  heightPct: number; // band height, %
  fontScale: number; // verse size multiplier (0.5..2)
  opacity: number;   // band background transparency, 0 (see-through) .. 1 (solid)
  style: ObsBandStyle;
};

// Default = a slim semi-transparent grey lower-third bar near the bottom (the
// broadcast look the church showed us, IMG_5490).
export const DEFAULT_OBS_BAND: ObsBandConfig = { topPct: 70, heightPct: 24, fontScale: 1, opacity: 0.6, style: "grey" };

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : NaN);
const dflt = (v: number, d: number) => (Number.isNaN(v) ? d : v);

/** Clamp a raw config to safe ranges AND keep the band on-screen. */
export function clampObsBand(c: Partial<ObsBandConfig>): ObsBandConfig {
  const heightPct = dflt(clamp(c.heightPct ?? DEFAULT_OBS_BAND.heightPct, 10, 60), DEFAULT_OBS_BAND.heightPct);
  // Cross-clamp: the band bottom (top + height) must not run off the frame.
  const topMax = Math.max(0, 100 - heightPct);
  const topPct = dflt(clamp(c.topPct ?? DEFAULT_OBS_BAND.topPct, 0, topMax), Math.min(DEFAULT_OBS_BAND.topPct, topMax));
  const fontScale = dflt(clamp(c.fontScale ?? DEFAULT_OBS_BAND.fontScale, 0.5, 2), DEFAULT_OBS_BAND.fontScale);
  const opacity = dflt(clamp(c.opacity ?? DEFAULT_OBS_BAND.opacity, 0, 1), DEFAULT_OBS_BAND.opacity);
  const style = (c.style && OBS_BAND_STYLES.includes(c.style)) ? c.style : DEFAULT_OBS_BAND.style;
  return { topPct, heightPct, fontScale, opacity, style };
}

// Position control as a full 0..100 "vertical placement" (0 = top of screen,
// 100 = flush against the bottom) — independent of band height, so the operator
// ALWAYS has full range and 100 means "at the very bottom" no matter how tall the
// band is. The renderer still consumes topPct; these convert between the two.
export function placementToTop(placement: number, heightPct: number): number {
  const p = Number.isFinite(placement) ? Math.min(100, Math.max(0, placement)) : 100;
  return Math.round((p / 100) * Math.max(0, 100 - heightPct));
}
export function topToPlacement(topPct: number, heightPct: number): number {
  const room = Math.max(0, 100 - heightPct);
  if (room <= 0) return 100;
  return Math.round((Math.min(topPct, room) / room) * 100);
}

/** URL query fragment (no leading `&`) encoding the band config for the OBS link. */
export function obsBandParams(c: ObsBandConfig): string {
  const b = clampObsBand(c);
  return `ltTop=${Math.round(b.topPct)}&ltH=${Math.round(b.heightPct)}&ltScale=${b.fontScale.toFixed(2)}&ltOpacity=${Math.round(b.opacity * 100)}&ltStyle=${b.style}`;
}

/** Parse the band config back out of the overlay URL's query params. */
export function parseObsBand(get: (k: string) => string | null): ObsBandConfig {
  const num = (k: string): number | undefined => {
    const raw = get(k);
    if (raw == null || raw === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };
  const opacityRaw = num("ltOpacity"); // 0..100 on the wire
  const rawStyle = get("ltStyle");
  return clampObsBand({
    topPct: num("ltTop"),
    heightPct: num("ltH"),
    fontScale: num("ltScale"),
    opacity: opacityRaw === undefined ? undefined : opacityRaw / 100,
    style: (rawStyle && OBS_BAND_STYLES.includes(rawStyle as ObsBandStyle)) ? (rawStyle as ObsBandStyle) : undefined,
  });
}

/**
 * The ScriptureBandWire the renderer consumes. STYLE picks the colour; the
 * OPACITY slider controls the band's transparency (except "clear" = always
 * transparent). "theme" mirrors the church's real theme colours.
 */
export function obsBandWire(c: ObsBandConfig, theme?: ObsThemeColors): ScriptureBandWire {
  const b = clampObsBand(c);
  const wire: ScriptureBandWire = { topPct: b.topPct, heightPct: b.heightPct, fontScale: b.fontScale };
  switch (b.style) {
    case "grey":     wire.color = "#4b5563"; wire.opacity = b.opacity; break;
    case "black":    wire.color = "#000000"; wire.opacity = b.opacity; break;
    case "frost":    wire.color = "#ffffff"; wire.opacity = b.opacity; break;
    // angle 180 = dark at the TOP of the band (behind the verse) fading down.
    case "gradient": wire.color = "#000000"; wire.color2 = "rgba(0,0,0,0)"; wire.angle = 180; wire.opacity = b.opacity; break;
    case "clear":    /* no paint → fully transparent, words + shadow only */ break;
    case "theme": {
      if (theme?.bgColor) {
        wire.color = theme.bgColor;
        if (theme.bgColor2) { wire.color2 = theme.bgColor2; wire.angle = theme.bgAngle ?? 180; }
        wire.opacity = b.opacity;
        // Mirror the projector's text colour when the theme sets one explicitly;
        // when it doesn't, leave textColor unset so the renderer auto-contrasts
        // against the band colour (= theme bg) exactly like the projector does.
        if (theme.textColor) wire.textColor = theme.textColor;
      } else {
        // Theme has an image/none background — can't mirror a solid colour; use a
        // neutral scrim (words stay white via the renderer's auto-contrast).
        wire.color = "#000000"; wire.opacity = b.opacity;
      }
      break;
    }
  }
  // At (near-)zero opacity the band is invisible, so any band-derived text colour
  // (e.g. dark "frost"/theme text) would float unreadable over the camera. Treat
  // it as fully transparent — drop the paint + textColor so the renderer forces
  // white shadowed text (identical to the "clear" style). Keeps low-opacity
  // legible over any feed.
  if (wire.color !== undefined && (wire.opacity ?? 1) <= 0.05) {
    delete wire.color; delete wire.color2; delete wire.angle; delete wire.opacity; delete wire.textColor;
  }
  return wire;
}

/**
 * The bandable text of a slide: its top-level text, or — for a designed slide
 * whose lyrics live only in text OBJECTS — the joined text of those objects, so a
 * designed song still shows its words in the caption instead of vanishing.
 */
export function bandableTextOf(slide: SlidePayload): string {
  if (slide.kind !== "text") return "";
  if (typeof slide.text === "string" && slide.text.trim()) return slide.text;
  if (Array.isArray(slide.objects)) {
    const parts = slide.objects
      .filter((o): o is Extract<typeof o, { kind: "text" }> => o.kind === "text" && typeof (o as { text?: unknown }).text === "string")
      .map((o) => (o as { text: string }).text.trim())
      .filter(Boolean);
    if (parts.length) return parts.join("\n");
  }
  return "";
}

/**
 * Wrap the live slide into a lower-third caption for the OBS overlay. Text slides
 * (songs + scripture) become a clean `scriptureLayout:"lowerThird"` slide carrying
 * the OBS band geometry + style, so SlideRenderer's band branch renders them with
 * the church's fonts (themeTextStyle) + auto-fit. NON-text slides become
 * `{kind:"empty"}` → the overlay shows nothing but the camera.
 *
 * Overlay-side only: never changes what the projector/operator receive, never
 * mutates the input slide.
 */
export function overlayBandSlide(slide: SlidePayload, c: ObsBandConfig, theme?: ObsThemeColors): SlidePayload {
  // Banded media carrying a caption → show the caption text in the OBS band
  // (never the picture itself). No caption → empty, as before.
  if ((slide.kind === "image" || slide.kind === "video") && slide.layout === "third"
    && typeof slide.caption === "string" && slide.caption.trim()) {
    return { kind: "text", text: slide.caption.trim(), scriptureLayout: "lowerThird", scriptureBand: obsBandWire(c, theme) };
  }
  if (slide.kind !== "text") return { kind: "empty" };
  const text = bandableTextOf(slide);
  if (!text.trim()) return { kind: "empty" };
  const out: Extract<SlidePayload, { kind: "text" }> = {
    kind: "text",
    text,
    scriptureLayout: "lowerThird",
    scriptureBand: obsBandWire(c, theme),
  };
  if (typeof slide.reference === "string" && slide.reference.trim()) out.reference = slide.reference;
  return out;
}

/** Validate an OBS band config that arrives over the wire (OutputState.obsLowerThird). */
export function isValidObsBand(v: unknown): v is ObsBandConfig {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  const numOk = (x: unknown, lo: number, hi: number) => typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi;
  return numOk(p.topPct, 0, 100) && numOk(p.heightPct, 1, 100) && numOk(p.fontScale, 0.1, 4)
    && numOk(p.opacity, 0, 1) && typeof p.style === "string" && OBS_BAND_STYLES.includes(p.style as ObsBandStyle);
}
