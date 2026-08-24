// Shared scripture-slide styling. Defines the design template (per-object
// geometry + style for the verse and the reference/translation line), builds
// the projectable payload, and persists the church's active style so a saved
// edit applies to EVERY scripture slide. Drag positions/sizes are captured in
// the template, so "Save (all slides)" reproduces the exact layout per verse.

import { projectableTextSlide, type SlidePayload } from "@/lib/broadcast";
import { newObjectId, CANVAS_W, CANVAS_H, type EditableSlide, type SlideObject, type TextObject } from "@/lib/slide-objects";

export type TextStyle = {
  x: number; y: number; w: number; h: number;
  fontFamily: string; fontSize: number; fontWeight: number;
  color: string; align: "left" | "center" | "right";
  italic: boolean; uppercase: boolean; shadow: boolean;
  stroke: string; strokeWidth: number; lineHeight: number; letterSpacing: number;
};

// NOTE: scripture slides deliberately carry NO per-slide background. The
// background always comes from the active theme / overall picked background
// (user directive 2026-08-24) — so a scripture slide styles TEXT only and lets
// the theme show through, exactly like every other slide.
export type ScriptureDesign = {
  verse: TextStyle;
  reference: TextStyle & { show: boolean; showTranslation: boolean };
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

export const DEFAULT_SCRIPTURE_DESIGN: ScriptureDesign = {
  verse: { ...VERSE_DEFAULT },
  reference: { ...REF_DEFAULT },
};

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
export function scriptureObjects(verseText: string, reference: string, translation: string | undefined, d: ScriptureDesign): SlideObject[] {
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
  return projectableTextSlide(verseText, undefined, undefined, scriptureObjects(verseText, reference, translation, d));
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
  return { verse, reference };
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
      verse: { ...DEFAULT_SCRIPTURE_DESIGN.verse, ...parsed.verse },
      reference: { ...DEFAULT_SCRIPTURE_DESIGN.reference, ...parsed.reference },
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
