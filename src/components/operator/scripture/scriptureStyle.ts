// Shared scripture-slide styling: one place that defines the design shape,
// builds the projectable payload, and persists the church's active style so a
// saved edit applies to EVERY scripture slide (not just the one being edited).
//
// Increment 2 will grow this into multiple named styles ("teams"); for now it's
// a single active style per church, persisted to localStorage in the dummy app.

import { projectableTextSlide, type SlidePayload } from "@/lib/broadcast";
import { newObjectId, CANVAS_W, CANVAS_H, type SlideObject, type TextObject, type ImageObject, type ShapeObject } from "@/lib/slide-objects";

export type ScriptureDesign = {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  align: "left" | "center" | "right";
  italic: boolean;
  uppercase: boolean;
  shadow: boolean;
  stroke: string;
  strokeWidth: number;
  lineHeight: number;
  letterSpacing: number;
  bgColor: string;
  bgImageUrl: string;
  bgFit: "cover" | "contain";
  showReference: boolean;
};

export const DEFAULT_SCRIPTURE_DESIGN: ScriptureDesign = {
  fontFamily: "Sora", fontSize: 96, fontWeight: 700, color: "#ffffff", align: "center",
  italic: false, uppercase: false, shadow: true, stroke: "#000000", strokeWidth: 0,
  lineHeight: 1.15, letterSpacing: 0,
  bgColor: "#0a0a0a", bgImageUrl: "", bgFit: "cover", showReference: true,
};

// Build the design as slide objects: full-canvas background + verse text +
// (optional) reference line. All locked (scripture text is immutable).
export function scriptureObjects(verseText: string, reference: string, d: ScriptureDesign): SlideObject[] {
  const bgObject: ImageObject | ShapeObject = d.bgImageUrl
    ? { id: newObjectId(), kind: "image", x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, url: d.bgImageUrl, fit: d.bgFit, locked: true }
    : { id: newObjectId(), kind: "shape", x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, shape: "rect", fill: d.bgColor, strokeWidth: 0, radius: 0, locked: true };
  const textObject: TextObject = {
    id: newObjectId(), kind: "text",
    x: 80, y: 40, w: CANVAS_W - 160, h: CANVAS_H - (d.showReference ? 200 : 80),
    text: verseText,
    fontFamily: d.fontFamily, fontSize: d.fontSize, fontWeight: d.fontWeight,
    color: d.color, align: d.align, italic: d.italic, uppercase: d.uppercase,
    shadow: d.shadow, stroke: d.stroke, strokeWidth: d.strokeWidth,
    lineHeight: d.lineHeight, letterSpacing: d.letterSpacing,
    locked: true,
  };
  const objects: SlideObject[] = [bgObject, textObject];
  if (d.showReference && reference) {
    objects.push({
      id: newObjectId(), kind: "text",
      x: 80, y: CANVAS_H - 140, w: CANVAS_W - 160, h: 100,
      text: reference,
      fontFamily: d.fontFamily, fontSize: 40, fontWeight: 500,
      color: d.color, align: d.align, opacity: 0.85, shadow: d.shadow,
      locked: true,
    });
  }
  return objects;
}

// The projectable payload — routed through projectableTextSlide, the EXACT
// converter the song editor uses, so scripture projects identically to songs.
export function scriptureSlidePayload(verseText: string, reference: string, d: ScriptureDesign): SlidePayload {
  return projectableTextSlide(verseText, d.bgColor, d.bgImageUrl || undefined, scriptureObjects(verseText, reference, d));
}

// ---- Persistence (active style per church) --------------------------------

const KEY = (churchId?: string) => `pf.scriptureStyle.${churchId || "default"}`;

export function loadScriptureStyle(churchId?: string): ScriptureDesign {
  if (typeof window === "undefined") return DEFAULT_SCRIPTURE_DESIGN;
  try {
    const raw = window.localStorage.getItem(KEY(churchId));
    if (!raw) return DEFAULT_SCRIPTURE_DESIGN;
    return { ...DEFAULT_SCRIPTURE_DESIGN, ...(JSON.parse(raw) as Partial<ScriptureDesign>) };
  } catch { return DEFAULT_SCRIPTURE_DESIGN; }
}

export function saveScriptureStyle(churchId: string | undefined, design: ScriptureDesign): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY(churchId), JSON.stringify(design));
    // Notify any open scripture surfaces (BibleMode) to re-apply the new style.
    window.dispatchEvent(new CustomEvent("pf-scripture-style-changed"));
  } catch { /* ignore */ }
}

export function hasSavedScriptureStyle(churchId?: string): boolean {
  if (typeof window === "undefined") return false;
  try { return !!window.localStorage.getItem(KEY(churchId)); } catch { return false; }
}
