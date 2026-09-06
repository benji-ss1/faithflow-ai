/**
 * OBS overlay LOWER-THIRD helpers (2026-09-06 field request, IMG_5489/5490).
 *
 * The OBS Browser Source overlay (`/livestream?bg=transparent`) rendered song
 * lyrics FULL-SCREEN over the camera. Churches want a broadcast-style LOWER
 * THIRD instead — as an OPTION set in the OBS setup card, DECOUPLED from the
 * projector (the projector/operator stay full-screen; only OBS goes lower-third).
 *
 * This module is the shared contract between the setup card (which mints the OBS
 * URL) and `/livestream` (which renders it): a compact geometry + STYLE config
 * carried on the URL as query params, plus a pure `overlayBandSlide()` that wraps
 * whatever slide is live into a `scriptureLayout:"lowerThird"` slide so it renders
 * through SlideRenderer's PROVEN band branch — auto-fit, church fonts via
 * themeTextStyle(appearance), no clipping, movable geometry, 5 band looks. Purely
 * overlay-side: it never touches the OutputState the projector receives.
 *
 * Pure + deterministic (no window/DOM) so it is unit-testable and safe to import
 * on both the card and the render page.
 */
import type { SlidePayload, ScriptureBandWire } from "./broadcast";

// The 5 band background looks the operator can choose (user request: "one like
// this and 4 other options … transparent etc"). Each maps to band paint below.
export type ObsBandStyle = "grey" | "black" | "clear" | "gradient" | "frost";
export const OBS_BAND_STYLES: ObsBandStyle[] = ["grey", "black", "clear", "gradient", "frost"];

export type ObsBandConfig = {
  topPct: number;    // band top edge, % of the 1080 canvas
  heightPct: number; // band height, %
  fontScale: number; // verse size multiplier (0.5..2)
  style: ObsBandStyle;
};

// Default = the semi-transparent grey bar the church showed us (IMG_5490).
export const DEFAULT_OBS_BAND: ObsBandConfig = { topPct: 66, heightPct: 30, fontScale: 1, style: "grey" };

// Per-style metadata for the setup card: a human label + CSS the card's live
// preview uses (kept here so the card and the renderer agree on every look).
export const OBS_BAND_STYLE_META: Record<ObsBandStyle, { label: string; hint: string; previewBg: string; previewText: string }> = {
  grey:     { label: "Soft grey",     hint: "Semi-transparent grey bar (broadcast default)", previewBg: "rgba(75,85,99,0.6)",  previewText: "#ffffff" },
  black:    { label: "Solid black",   hint: "Darker bar for maximum legibility",             previewBg: "rgba(0,0,0,0.7)",     previewText: "#ffffff" },
  clear:    { label: "Clear",         hint: "No bar — just the words (most see-through)",     previewBg: "transparent",         previewText: "#ffffff" },
  gradient: { label: "Gradient fade", hint: "Soft dark fade behind the words",                 previewBg: "linear-gradient(180deg, rgba(0,0,0,0.85), rgba(0,0,0,0))", previewText: "#ffffff" },
  frost:    { label: "Frosted light", hint: "Light bar with dark words",                      previewBg: "rgba(255,255,255,0.82)", previewText: "#111111" },
};

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : NaN);
const dflt = (v: number, d: number) => (Number.isNaN(v) ? d : v);

/** Clamp a raw config to safe ranges (defensive) AND keep the band on-screen. */
export function clampObsBand(c: Partial<ObsBandConfig>): ObsBandConfig {
  const heightPct = dflt(clamp(c.heightPct ?? DEFAULT_OBS_BAND.heightPct, 10, 60), DEFAULT_OBS_BAND.heightPct);
  // Cross-clamp: the band bottom (top + height) must not run off the frame, so
  // cap top at 100 - height (a 30% band tops out at 70%, a 60% band at 40%).
  const topMax = Math.max(0, 100 - heightPct);
  const topPct = dflt(clamp(c.topPct ?? DEFAULT_OBS_BAND.topPct, 0, topMax), Math.min(DEFAULT_OBS_BAND.topPct, topMax));
  const fontScale = dflt(clamp(c.fontScale ?? DEFAULT_OBS_BAND.fontScale, 0.5, 2), DEFAULT_OBS_BAND.fontScale);
  const style = (c.style && OBS_BAND_STYLES.includes(c.style)) ? c.style : DEFAULT_OBS_BAND.style;
  return { topPct, heightPct, fontScale, style };
}

/** URL query fragment (no leading `&`) encoding the band config for the OBS link. */
export function obsBandParams(c: ObsBandConfig): string {
  const b = clampObsBand(c);
  return `ltTop=${Math.round(b.topPct)}&ltH=${Math.round(b.heightPct)}&ltScale=${b.fontScale.toFixed(2)}&ltStyle=${b.style}`;
}

/** Parse the band config back out of the overlay URL's query params. */
export function parseObsBand(get: (k: string) => string | null): ObsBandConfig {
  const num = (k: string): number | undefined => {
    const raw = get(k);
    if (raw == null || raw === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };
  const rawStyle = get("ltStyle");
  return clampObsBand({
    topPct: num("ltTop"),
    heightPct: num("ltH"),
    fontScale: num("ltScale"),
    style: (rawStyle && OBS_BAND_STYLES.includes(rawStyle as ObsBandStyle)) ? (rawStyle as ObsBandStyle) : undefined,
  });
}

/** The ScriptureBandWire the renderer consumes for this config's STYLE. */
export function obsBandWire(c: ObsBandConfig): ScriptureBandWire {
  const b = clampObsBand(c);
  const wire: ScriptureBandWire = { topPct: b.topPct, heightPct: b.heightPct, fontScale: b.fontScale };
  switch (b.style) {
    case "grey":     wire.color = "#4b5563"; wire.opacity = 0.6; break;
    case "black":    wire.color = "#000000"; wire.opacity = 0.7; break;
    // angle 180 = dark at the TOP of the band (behind the verse, which sits near
    // the band top) fading to transparent at the bottom — keeps the main text on
    // the darkest part for legibility over a bright camera.
    case "gradient": wire.color = "#000000"; wire.color2 = "rgba(0,0,0,0)"; wire.angle = 180; wire.opacity = 1; break;
    case "frost":    wire.color = "#ffffff"; wire.opacity = 0.82; break;
    case "clear":    /* no paint → transparent band, words + shadow only */ break;
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
 * the church's fonts (themeTextStyle) + auto-fit. NON-text slides (image/video/
 * logo) become `{kind:"empty"}` → the overlay shows nothing but the camera (a
 * lyric caption should never slap a full-frame picture over the broadcast).
 *
 * Overlay-side only: this never changes what the projector/operator receive, and
 * it never mutates the input slide.
 */
export function overlayBandSlide(slide: SlidePayload, c: ObsBandConfig): SlidePayload {
  if (slide.kind !== "text") return { kind: "empty" };
  const text = bandableTextOf(slide);
  if (!text.trim()) return { kind: "empty" };
  const out: Extract<SlidePayload, { kind: "text" }> = {
    kind: "text",
    text,
    scriptureLayout: "lowerThird",
    scriptureBand: obsBandWire(c),
  };
  // Preserve a scripture reference so the band's footer still shows it.
  if (typeof slide.reference === "string" && slide.reference.trim()) out.reference = slide.reference;
  return out;
}
