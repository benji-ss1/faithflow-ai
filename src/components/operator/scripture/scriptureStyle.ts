// Shared scripture-slide styling. Defines the design template (per-object
// geometry + style for the verse and the reference/translation line), builds
// the projectable payload, and persists the church's active style so a saved
// edit applies to EVERY scripture slide. Drag positions/sizes are captured in
// the template, so "Save (all slides)" reproduces the exact layout per verse.

import { projectableTextSlide, type SlidePayload, type ScriptureBandWire } from "@/lib/broadcast";
import { newObjectId, type EditableSlide, type SlideObject, type TextObject } from "@/lib/slide-objects";
import { designFromThemeScripture, type ThemeScriptureOptions } from "@/lib/theme-scripture";
import { DEFAULT_SCRIPTURE_DESIGN, BAND_DEFAULT, sanitizeBandStyle, clampNum, type TextStyle, type BandStyle, type ScriptureDesign } from "@/lib/scripture-design";
import { getScriptureStyle, setLocalScriptureStyle } from "@/lib/church-styles-store";

// Types, defaults and sanitizers live in the pure, server-safe
// src/lib/scripture-design.ts (so server actions validate identically); they are
// re-exported here so every existing import keeps working.
export {
  BAND_DEFAULT, DEFAULT_SCRIPTURE_DESIGN, sanitizeBandStyle, sanitizeScriptureDesign,
  type TextStyle, type ScriptureLayout, type ThirdPosition, type BandStyle, type ScriptureDesign,
} from "@/lib/scripture-design";

// The band's top edge (%), derived from position + nudge, clamped on-screen.
export function bandTopPct(b: BandStyle): number {
  const base =
    b.position === "upper" ? 6 :
    b.position === "mid" ? 50 - b.heightPct / 2 :
    100 - b.heightPct - 2; // lower: 2% bottom margin
  return clampNum(base + b.offsetY, 0, 100 - b.heightPct);
}

// The wire band for a design, or undefined when the band shouldn't paint
// (fullscreen layout, or a transparent "none" lower-third). Only the paint is
// carried — the renderer owns geometry so preview == projector.
export function bandWireFromDesign(d: ScriptureDesign): ScriptureBandWire | undefined {
  if (d.layout !== "lowerThird") return undefined;
  // Defence-in-depth: a design that didn't come through loadScriptureStyle (e.g.
  // an editor draft) is clamped too, so the wire band always validates.
  const b = sanitizeBandStyle(d.band);
  // Geometry is ALWAYS carried (even for a "none" band) so the verse is placed
  // in the right third; paint is added only for solid/gradient.
  const wire: ScriptureBandWire = { topPct: bandTopPct(b), heightPct: b.heightPct, fontScale: b.fontScale };
  // Only when changed from the default, so an untouched church's wire (and output
  // identity) is byte-identical to before these controls existed.
  // "Same size as the verse" on the band. The renderer sizes the verse with
  // factor 0.22 and the reference with 0.11, so they are equal when
  // refScale = 2 x fontScale. Clamped to the band's own refScale range, so a
  // large verse scale saturates rather than emitting an invalid wire value.
  const refScale = d.reference.matchVerseSize === true
    ? clampNum(b.fontScale * 2, 0.5, 3)
    : b.refScale;
  if (refScale !== BAND_DEFAULT.refScale) wire.refScale = refScale;
  if (b.widthPct !== BAND_DEFAULT.widthPct) wire.widthPct = b.widthPct;
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
    // "Same size as the verse" (ProPresenter's "Reference: With Verse").
    // OPT-IN, default off: when off this is the untouched reference style, so
    // an existing church's slide is byte-identical to before the option existed.
    const refStyle = d.reference.matchVerseSize === true
      ? { ...d.reference, fontSize: d.verse.fontSize }
      : d.reference;
    objects.push(textObjectFrom(refStyle, referenceLabel(reference, translation, d.reference.showTranslation)));
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
// Theme → Projector (PR 2): a scripture slide styled from the resolved THEME's
// scripture options (only used when there is no saved Scripture Style — the
// saved style always wins). Text objects are role-tagged (verse / reference) so
// the renderer fits them in their boxes; the reference object is kept but
// HIDDEN when the theme hides the reference or shows it inline. The dedicated
// `reference` field is ALWAYS carried — anti-replay (bible-antireplay.ts
// liveGuardText) identifies the live verse by it.
export function themeScripturePayload(verseText: string, reference: string, translation: string | undefined, opts: ThemeScriptureOptions): SlidePayload {
  const d = designFromThemeScripture(opts, DEFAULT_SCRIPTURE_DESIGN);
  // A theme can now carry the lower-third BAND (2026-09-20). Take the same plain
  // band payload a saved Scripture Style takes — the renderer owns the geometry, so
  // preview, projector, stage and livestream stay identical to a saved band.
  if (d.layout === "lowerThird") return scriptureLowerThirdPayload(verseText, reference, translation, d);
  const label = reference ? referenceLabel(reference, translation, d.reference.showTranslation) : "";
  const inline = opts.position === "inline" && d.reference.show && !!label;
  const verseObj: TextObject = { ...textObjectFrom(d.verse, inline ? `${verseText} — ${label}` : verseText), role: "verse" };
  const objects: SlideObject[] = [verseObj];
  if (label) {
    const refObj: TextObject = { ...textObjectFrom(d.reference, label), role: "reference" };
    if (!d.reference.show || inline) refObj.hidden = true;
    objects.push(refObj);
  }
  const p = projectableTextSlide(verseText, undefined, undefined, objects);
  if (p.kind === "text" && label) p.reference = label;
  return p;
}

export function styleScriptureSlide(slide: SlidePayload, churchId: string, themeOpts?: ThemeScriptureOptions | null): SlidePayload {
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
    // Decision 4: saved Scripture Style wins; theme options only without one.
    if (themeOpts && !hasSavedScriptureStyle(churchId)) return themeScripturePayload(slide.text, refText, translation, themeOpts);
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
//   • media (image/video) is NEVER banded by the church default (full screen
//     always); only an explicit per-slide media layout bands it.
// Deterministic + never throws (a failure falls back to the original slide) so a
// live send is never broken, and the identity guarding the already-live skip /
// fade-pulse stays stable across heartbeats.
export function applyChurchLayout(slide: SlidePayload, churchId: string, themeOpts?: ThemeScriptureOptions | null): SlidePayload {
  // Scripture first — returns a NEW styled payload for an unstyled verse, or the
  // SAME slide ref for non-scripture / already-styled sends.
  const scriptured = styleScriptureSlide(slide, churchId, themeOpts);
  if (scriptured !== slide) return scriptured;
  try {
    // Media (image/video): ALWAYS full screen, like ProPresenter (2026-09-17
    // owner decision) — the church lower-third default is for WORDS only. A
    // per-slide layout set explicitly in the media editor (e.g. caption) is
    // carried as-is and still renders in the band.
    if (slide.kind === "image" || slide.kind === "video") return slide;
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
//   • image/video → returned unchanged: plain media stays full screen and an
//     explicit per-slide layout (media editor) is kept, so the toggle is a no-op.
// Anything not styled is returned unchanged.
export function sourceForRelayout(slide: SlidePayload): SlidePayload {
  if (slide.kind === "text") {
    if (slide.reference) return { kind: "text", text: slide.text, reference: slide.reference };
    if (slide.scriptureLayout || slide.scriptureBand) {
      const p: Extract<SlidePayload, { kind: "text" }> = { kind: "text", text: slide.text };
      if (slide.bgColor) p.bgColor = slide.bgColor;
      // Carry the "chosen" marker with the colour, else toggling layout drops a
      // designed slide's deliberate black back to the legacy heuristic.
      if (slide.bgExplicit) p.bgExplicit = true;
      if (slide.bgImageUrl) p.bgImageUrl = slide.bgImageUrl;
      if (slide.objects && slide.objects.length) p.objects = slide.objects;
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
// PR B (2026-09-17): the style is stored per CHURCH on the server
// (church_preferences.scripture_style) and cached synchronously in
// church-styles-store. Signatures are unchanged and still synchronous; the
// legacy per-machine key pf.scriptureStyle.v2.<churchId> is a READ-ONLY
// fallback until the store is hydrated (kept one release).

export function loadScriptureStyle(churchId?: string): ScriptureDesign {
  return getScriptureStyle(churchId) ?? DEFAULT_SCRIPTURE_DESIGN;
}

export function saveScriptureStyle(churchId: string | undefined, design: ScriptureDesign): void {
  setLocalScriptureStyle(churchId, design);
}

/** Remove the church's saved Scripture Style (so a theme's scripture boxes apply). */
export function clearScriptureStyle(churchId: string | undefined): void {
  setLocalScriptureStyle(churchId, null);
}

export function hasSavedScriptureStyle(churchId?: string): boolean {
  return getScriptureStyle(churchId) !== null;
}
