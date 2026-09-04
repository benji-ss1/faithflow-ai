// Shared scripture-slide styling. Defines the design template (per-object
// geometry + style for the verse and the reference/translation line), builds
// the projectable payload, and persists the church's active style so a saved
// edit applies to EVERY scripture slide. Drag positions/sizes are captured in
// the template, so "Save (all slides)" reproduces the exact layout per verse.

import { projectableTextSlide, type SlidePayload, type ScriptureBandWire } from "@/lib/broadcast";
import { newObjectId, CANVAS_W, CANVAS_H, type EditableSlide, type SlideObject, type TextObject } from "@/lib/slide-objects";

export type TextStyle = {
  x: number; y: number; w: number; h: number;
  fontFamily: string; fontSize: number; fontWeight: number;
  color: string; align: "left" | "center" | "right";
  italic: boolean; uppercase: boolean; shadow: boolean;
  stroke: string; strokeWidth: number; lineHeight: number; letterSpacing: number;
};

// Scripture projection layout. "fullscreen" = the classic full-canvas verse
// (styled per-object, drag-editable). "lowerThird" = Christ Embassy's lower-
// third mode: a big verse confined to a bottom band (optionally coloured), so a
// verse can be composited over the church's own content. The band's geometry is
// owned by the renderer; the design only carries the band paint + which layout.
export type ScriptureLayout = "fullscreen" | "lowerThird";

// Which third of the screen the band sits in. Christ Embassy's real projectors
// are mounted high and the very bottom is blocked, so a bottom-third caption
// reads too low — they need to move it up (mid/upper) and nudge it.
export type ThirdPosition = "upper" | "mid" | "lower";

// The scripture band. mode "none" = transparent (verse floats with a shadow —
// for compositing over a busy feed); "solid" = flat colour; "gradient" = colour
// → color2. Default is a BLACK solid band (safest legibility). `position` +
// `offsetY` place it in/around a third; `heightPct` sets how tall the band is;
// `fontScale` scales the verse text so it can be made much bigger/readable.
export type BandStyle = {
  mode: "none" | "solid" | "gradient";
  color: string;
  color2: string;
  angle: number;   // gradient angle in degrees
  opacity: number; // 0..1
  position: ThirdPosition;
  offsetY: number;   // fine vertical nudge, % of screen height (−25..25); + = down
  heightPct: number; // band height, % of screen height (16..48)
  fontScale: number; // verse size multiplier (0.6..2)
};

const clampNum = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// The band's top edge (%), derived from position + nudge, clamped on-screen.
export function bandTopPct(b: BandStyle): number {
  const base =
    b.position === "upper" ? 6 :
    b.position === "mid" ? 50 - b.heightPct / 2 :
    100 - b.heightPct - 2; // lower: 2% bottom margin
  return clampNum(base + b.offsetY, 0, 100 - b.heightPct);
}

// NOTE: scripture slides deliberately carry NO per-slide background. The
// background always comes from the active theme / overall picked background
// (user directive 2026-08-24) — so a scripture slide styles TEXT only and lets
// the theme show through, exactly like every other slide. (The lower-third band
// is NOT a background — it is a foreground scrim drawn behind the verse text
// only, so the theme/camera still shows above and below it.)
export type ScriptureDesign = {
  layout: ScriptureLayout;
  verse: TextStyle;
  reference: TextStyle & { show: boolean; showTranslation: boolean };
  band: BandStyle;
};

const VERSE_DEFAULT: TextStyle = {
  x: 80, y: 60, w: CANVAS_W - 160, h: CANVAS_H - 260,
  fontFamily: "Sora", fontSize: 96, fontWeight: 700, color: "#ffffff", align: "center",
  italic: false, uppercase: false, shadow: true, stroke: "#000000", strokeWidth: 0,
  lineHeight: 1.15, letterSpacing: 0,
};
const REF_DEFAULT: TextStyle & { show: boolean; showTranslation: boolean } = {
  x: 80, y: CANVAS_H - 150, w: CANVAS_W - 160, h: 110,
  fontFamily: "Sora", fontSize: 44, fontWeight: 500, color: "#ffffff", align: "center",
  italic: false, uppercase: false, shadow: true, stroke: "#000000", strokeWidth: 0,
  lineHeight: 1.1, letterSpacing: 1,
  show: true, showTranslation: true,
};

// Black band by default — legible over ANY content the church runs underneath.
export const BAND_DEFAULT: BandStyle = {
  mode: "solid", color: "#000000", color2: "#000000", angle: 180, opacity: 0.72,
  position: "lower", offsetY: 0, heightPct: 30, fontScale: 1,
};

export const DEFAULT_SCRIPTURE_DESIGN: ScriptureDesign = {
  layout: "fullscreen",
  verse: { ...VERSE_DEFAULT },
  reference: { ...REF_DEFAULT },
  band: { ...BAND_DEFAULT },
};

// The wire band for a design, or undefined when the band shouldn't paint
// (fullscreen layout, or a transparent "none" lower-third). Only the paint is
// carried — the renderer owns geometry so preview == projector.
export function bandWireFromDesign(d: ScriptureDesign): ScriptureBandWire | undefined {
  if (d.layout !== "lowerThird") return undefined;
  const b = d.band;
  // Geometry is ALWAYS carried (even for a "none" band) so the verse is placed
  // in the right third; paint is added only for solid/gradient.
  const wire: ScriptureBandWire = { topPct: bandTopPct(b), heightPct: b.heightPct, fontScale: b.fontScale };
  if (b.mode !== "none") {
    wire.color = b.color;
    wire.opacity = b.opacity;
    if (b.mode === "gradient") { wire.color2 = b.color2; wire.angle = b.angle; }
  }
  return wire;
}

// A lower-third scripture payload: a PLAIN text slide (no per-object geometry)
// marked scriptureLayout:"lowerThird" so the renderer's dedicated lower-third
// branch confines the verse to the bottom band, auto-fits it big, and paginates
// long verses — reusing AutoFitText. The reference rides the dedicated field so
// the always-visible footer shows it. No `objects` → never hits the fullscreen
// designed-objects path.
export function scriptureLowerThirdPayload(verseText: string, reference: string, translation: string | undefined, d: ScriptureDesign): SlidePayload {
  const p: Extract<SlidePayload, { kind: "text" }> = { kind: "text", text: verseText, scriptureLayout: "lowerThird" };
  if (reference) p.reference = referenceLabel(reference, translation, d.reference.showTranslation);
  const band = bandWireFromDesign(d);
  if (band) p.scriptureBand = band;
  return p;
}

// The reference label shown (with or without translation).
export function referenceLabel(reference: string, translation: string | undefined, showTranslation: boolean): string {
  // Strip any existing "(TRANS)" so we never double it (idempotent).
  const ref = reference.trim().replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (!showTranslation || !translation) return ref;
  return `${ref} (${translation})`;
}

function textObjectFrom(s: TextStyle, text: string): TextObject {
  return {
    id: newObjectId(), kind: "text",
    x: s.x, y: s.y, w: s.w, h: s.h,
    text,
    fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight,
    color: s.color, align: s.align, italic: s.italic, uppercase: s.uppercase,
    shadow: s.shadow, stroke: s.stroke, strokeWidth: s.strokeWidth,
    lineHeight: s.lineHeight, letterSpacing: s.letterSpacing,
  };
}

// Objects for a scripture slide: verse + (optional) reference. NO background
// object — the theme's background shows through (SlideRenderer's designBg falls
// back to the theme when the slide has no bgColor/bgImageUrl).
function scriptureObjects(verseText: string, reference: string, translation: string | undefined, d: ScriptureDesign): SlideObject[] {
  const objects: SlideObject[] = [textObjectFrom(d.verse, verseText)];
  if (d.reference.show && reference) {
    objects.push(textObjectFrom(d.reference, referenceLabel(reference, translation, d.reference.showTranslation)));
  }
  return objects;
}

// An editable slide for the SlideCanvas (verse + reference draggable/resizable).
// No bgColor/bgImageUrl → the theme background is authoritative.
export function scriptureEditableSlide(verseText: string, reference: string, translation: string | undefined, d: ScriptureDesign): EditableSlide {
  return { id: "scripture-edit", objects: scriptureObjects(verseText, reference, translation, d) };
}

// The projectable payload — routed through projectableTextSlide (the exact
// converter the song editor uses). No bg passed → theme background is used.
export function scriptureSlidePayload(verseText: string, reference: string, translation: string | undefined, d: ScriptureDesign): SlidePayload {
  // Lower-third layout takes the dedicated plain-payload path (no per-object
  // geometry — the renderer confines + auto-fits the verse in the band).
  if (d.layout === "lowerThird") return scriptureLowerThirdPayload(verseText, reference, translation, d);
  const p = projectableTextSlide(verseText, undefined, undefined, scriptureObjects(verseText, reference, translation, d));
  // ALWAYS carry the reference in the dedicated field — even when the operator
  // hid the movable reference OBJECT — so it is never stripped from the payload
  // and the footer path can still surface it (the "reference must always appear"
  // invariant). Not gated on d.reference.show.
  if (p.kind === "text" && reference) {
    p.reference = referenceLabel(reference, translation, d.reference.showTranslation);
  }
  return p;
}

// PREVIEW≠LIVE parity fix (2026-08-25, field report). The AI auto-fire and
// verse-nav paths build a PLAIN scripture slide — `{ text, reference }` with NO
// style objects. The live SlideRenderer then applies AutoFitText's default
// "always-on UPPERCASE, bold" crowd-readability style instead of the church's
// saved scripture design, so the projector did NOT match the styled operator
// preview (which builds the slide via scriptureSlidePayload → styled objects).
// The operator had to manually re-click the verse to get the correct styling.
//
// styleScriptureSlide applies the saved design to any plain scripture slide so
// EVERY send path (AI auto-fire, verse-nav, manual) projects the church's
// styling — called once centrally in OperatorConsole.sendSlideToLive. Gated to
// scripture (has a `reference`) with no objects yet, so song lyrics (`{ text }`,
// no reference) and already-styled sends (scriptureSlidePayload carries objects)
// pass through UNTOUCHED. Deterministic: a given (verse, reference, design)
// always yields the same objects geometry/style, and object IDs are NOT part of
// slideDesignSig, so the content-identity guarding the already-live skip +
// fade-pulse behaviour in sendSlideToLive is unchanged. Never throws — a styling
// failure falls back to the plain slide so a live send is never broken.
export function styleScriptureSlide(slide: SlidePayload, churchId: string): SlidePayload {
  if (slide.kind !== "text" || !slide.reference) return slide;
  if (slide.objects && slide.objects.length > 0) return slide; // already styled (fullscreen)
  if (slide.scriptureLayout) return slide; // already styled (lower-third)
  try {
    // Cap before the regex: `reference` is not length-validated on the wire, and
    // the match `^(.*?)\s*\(…\)$` is O(n²) on a pathological all-"(" string. A
    // real bible reference is short; a 200-char cap closes the latent ReDoS
    // cheaply (defence-in-depth — references are internally generated today).
    const m = slide.reference.slice(0, 200).match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    const refText = m ? m[1].trim() : slide.reference;
    const translation = m ? m[2].trim() : undefined;
    return scriptureSlidePayload(slide.text, refText, translation, loadScriptureStyle(churchId));
  } catch {
    return slide;
  }
}

// The lyrics/text to band for a plain or designed text slide: the raw `text`
// field if present, else the first text object's text (a designed song stores
// its words in an object). Empty → caller leaves the slide unbanded.
function bandableTextOf(slide: Extract<SlidePayload, { kind: "text" }>): string {
  // Prefer the flattened `text` (the full lyrics/verse). Only when it's empty do
  // we fall back to the objects — and then join ALL text objects (not just the
  // first) so a multi-text designed slide never silently drops words.
  if (typeof slide.text === "string" && slide.text.trim()) return slide.text;
  const parts = (slide.objects ?? [])
    .filter((o) => o.kind === "text" && typeof (o as { text?: unknown }).text === "string")
    .map((o) => (o as { text?: string }).text as string)
    .filter((t) => t.trim());
  return parts.join("\n");
}

// A lower-third payload for a SONG / plain text slide (no scripture reference):
// the exact same band mechanism verses use, minus the reference footer. Reuses
// the renderer's lower-third branch (confine + auto-fit + paginate) verbatim.
export function songLowerThirdPayload(text: string, d: ScriptureDesign): SlidePayload {
  const p: Extract<SlidePayload, { kind: "text" }> = { kind: "text", text, scriptureLayout: "lowerThird" };
  const band = bandWireFromDesign(d);
  if (band) p.scriptureBand = band;
  return p;
}

// CENTRAL layout application — called once in OperatorConsole.sendSlideToLive for
// EVERY send (AI auto-fire, verse-nav, manual, songs, media). It applies the
// church's saved projection layout to ANY content so "set it once, applies to
// everything going forward" holds:
//   • scripture (has a reference) → full scripture styling via styleScriptureSlide
//     (fullscreen designed OR lower-third band, per the saved design) — unchanged.
//   • songs / plain text (no reference) → when the church default layout is
//     lower-third, confine the lyrics into the same band; when fullscreen, leave
//     the slide exactly as-is (existing behaviour, zero regression).
//   • a slide that already carries a per-slide `scriptureLayout` is an explicit
//     override and is left untouched (per-slide wins over the church default).
//   • media (image/video) is left to its own path (handled elsewhere).
// Deterministic + never throws (a failure falls back to the original slide) so a
// live send is never broken, and the identity guarding the already-live skip /
// fade-pulse stays stable across heartbeats.
export function applyChurchLayout(slide: SlidePayload, churchId: string): SlidePayload {
  // Scripture first — returns a NEW styled payload for an unstyled verse, or the
  // SAME slide ref for non-scripture / already-styled sends.
  const scriptured = styleScriptureSlide(slide, churchId);
  if (scriptured !== slide) return scriptured;
  try {
    // Media (image/video): when the church default is lower-third, confine the
    // media into the same band (default "fit" = shrink into the third). A
    // per-slide layout (set in the media editor, e.g. a caption) wins.
    if (slide.kind === "image" || slide.kind === "video") {
      if (slide.layout) return slide;
      const d = loadScriptureStyle(churchId);
      if (d.layout !== "lowerThird") return slide;
      return { ...slide, layout: "third", band: bandWireFromDesign(d), bandMode: slide.bandMode ?? "fit" };
    }
    if (slide.kind !== "text") return slide;
    if (slide.reference) return slide;            // scripture (already handled)
    if (slide.scriptureLayout) return slide;      // per-slide override wins
    const d = loadScriptureStyle(churchId);
    if (d.layout !== "lowerThird") return slide; // church default is fullscreen → unchanged
    const text = bandableTextOf(slide);
    if (!text.trim()) return slide;
    return songLowerThirdPayload(text, d);
  } catch {
    return slide;
  }
}

// Reduce a possibly-ALREADY-STYLED slide back to its raw content form so
// applyChurchLayout can re-derive the CURRENT layout from scratch. This is what
// makes the live Full⇄Third toggle actually reverse the slide on screen: the
// manual scripture card path pre-styles the payload (objects for fullscreen /
// scriptureLayout for the band), and re-sending THAT would no-op in
// styleScriptureSlide (it skips already-styled slides). We strip:
//   • scripture (has a reference) → back to a plain { text, reference } verse so
//     the saved design + current layout are re-applied fresh (both directions).
//   • songs/plain text carrying a band → drop the band, KEEP any designed objects
//     (a designed song keeps its design when it goes back to full screen).
//   • image/video carrying a third layout → drop layout/band/mode/caption.
// Anything not styled is returned unchanged.
export function sourceForRelayout(slide: SlidePayload): SlidePayload {
  if (slide.kind === "text") {
    if (slide.reference) return { kind: "text", text: slide.text, reference: slide.reference };
    if (slide.scriptureLayout || slide.scriptureBand) {
      const p: Extract<SlidePayload, { kind: "text" }> = { kind: "text", text: slide.text };
      if (slide.bgColor) p.bgColor = slide.bgColor;
      if (slide.bgImageUrl) p.bgImageUrl = slide.bgImageUrl;
      if (slide.objects && slide.objects.length) p.objects = slide.objects;
      return p;
    }
    return slide;
  }
  if (slide.kind === "image") {
    if (slide.layout || slide.band) {
      const p: Extract<SlidePayload, { kind: "image" }> = { kind: "image", url: slide.url };
      if (slide.fit) p.fit = slide.fit;
      if (slide.blurFill) p.blurFill = slide.blurFill;
      return p;
    }
    return slide;
  }
  if (slide.kind === "video") {
    if (slide.layout || slide.band) {
      const p: Extract<SlidePayload, { kind: "video" }> = { kind: "video", url: slide.url };
      if (slide.fit) p.fit = slide.fit;
      if (slide.loop !== undefined) p.loop = slide.loop;
      if (slide.volume !== undefined) p.volume = slide.volume;
      return p;
    }
    return slide;
  }
  return slide;
}

// Extract a reusable design template from an edited slide's objects (positions,
// sizes, styles) so "Save (all slides)" reproduces the layout for every verse.
export function designFromSlide(slide: EditableSlide, prev: ScriptureDesign): ScriptureDesign {
  const texts = slide.objects.filter((o): o is TextObject => o.kind === "text");
  const styleOf = (t: TextObject, base: TextStyle): TextStyle => ({
    x: t.x, y: t.y, w: t.w, h: t.h,
    fontFamily: t.fontFamily ?? base.fontFamily, fontSize: t.fontSize ?? base.fontSize,
    fontWeight: t.fontWeight ?? base.fontWeight, color: t.color ?? base.color,
    align: t.align ?? base.align, italic: !!t.italic, uppercase: !!t.uppercase,
    shadow: t.shadow ?? true, stroke: t.stroke ?? base.stroke, strokeWidth: t.strokeWidth ?? 0,
    lineHeight: t.lineHeight ?? base.lineHeight, letterSpacing: t.letterSpacing ?? base.letterSpacing,
  });
  // Convention: first text = verse, second (if present) = reference.
  const verse = texts[0] ? styleOf(texts[0], prev.verse) : prev.verse;
  const refText = texts[1];
  const reference: ScriptureDesign["reference"] = refText
    ? { ...styleOf(refText, prev.reference), show: !refText.hidden, showTranslation: prev.reference.showTranslation }
    : { ...prev.reference, show: false };
  // layout + band aren't draggable objects — carried from prev (the editor sets
  // them from its own toggle state before persisting).
  return { layout: prev.layout, verse, reference, band: { ...prev.band } };
}

// ---- Persistence (active style per church) --------------------------------

const KEY = (churchId?: string) => `pf.scriptureStyle.v2.${churchId || "default"}`;

export function loadScriptureStyle(churchId?: string): ScriptureDesign {
  if (typeof window === "undefined") return DEFAULT_SCRIPTURE_DESIGN;
  try {
    const raw = window.localStorage.getItem(KEY(churchId));
    if (!raw) return DEFAULT_SCRIPTURE_DESIGN;
    const parsed = JSON.parse(raw) as Partial<ScriptureDesign>;
    return {
      // back-compat: pre-lower-third saved styles have no layout/band → default
      // to fullscreen + the black band, so an existing church is unchanged.
      layout: parsed.layout === "lowerThird" ? "lowerThird" : "fullscreen",
      verse: { ...DEFAULT_SCRIPTURE_DESIGN.verse, ...parsed.verse },
      reference: { ...DEFAULT_SCRIPTURE_DESIGN.reference, ...parsed.reference },
      band: { ...DEFAULT_SCRIPTURE_DESIGN.band, ...parsed.band },
    };
  } catch { return DEFAULT_SCRIPTURE_DESIGN; }
}

export function saveScriptureStyle(churchId: string | undefined, design: ScriptureDesign): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY(churchId), JSON.stringify(design));
    window.dispatchEvent(new CustomEvent("pf-scripture-style-changed"));
  } catch { /* ignore */ }
}

export function hasSavedScriptureStyle(churchId?: string): boolean {
  if (typeof window === "undefined") return false;
  try { return !!window.localStorage.getItem(KEY(churchId)); } catch { return false; }
}
