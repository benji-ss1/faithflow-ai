/**
 * theme-decor-plan — PURE single source of truth for WHEN a theme's decor
 * objects (images / shapes / video / extra text from the theme slide) paint
 * behind a slide. Used by BOTH SlideRenderer (in-slide decor) and the output
 * compositor (the persistent `theme-decor` layer), so the two can never drift.
 *
 * No React, no DOM — node-testable.
 */
import type { SlidePayload, ThemeAppearance, SlideObjectWire } from "@/lib/broadcast";
import { coversCanvas } from "@/lib/slide-objects";

export interface ThemeDecorFlags {
  ignoreThemeLayout?: boolean;
  transparentBg?: boolean;
  fitBandFraction?: number;
  overVideo?: boolean;
  verticalAlign?: "top" | "center" | "bottom";
  editable?: boolean;
}

/** Theme boxes/decor apply only on a normal full-frame surface (mirrors SlideRenderer). */
export function themeBoxesAllowed(f: ThemeDecorFlags): boolean {
  return !f.ignoreThemeLayout && !f.transparentBg && typeof f.fitBandFraction !== "number" && !(f.overVideo && (f.verticalAlign ?? "center") !== "center");
}

/** The theme's decor for lyrics / scripture (scripture falls back to lyrics). */
export function themeDecorFor(appearance: ThemeAppearance | null | undefined, isScripture: boolean, f: ThemeDecorFlags): SlideObjectWire[] | undefined {
  const layout = themeBoxesAllowed(f) ? appearance?.layout : undefined;
  const d = layout ? (isScripture ? (layout.scripture?.decor ?? layout.lyrics?.decor) : layout.lyrics?.decor) : undefined;
  return d && d.length ? d : undefined;
}

/** True when the theme carries ANY decor (independent of the slide). */
export function themeHasDecor(appearance: ThemeAppearance | null | undefined): boolean {
  const l = appearance?.layout;
  return !!(l?.lyrics?.decor?.length || l?.scripture?.decor?.length);
}

function isDefaultSlideBg(c: string | null | undefined): boolean {
  if (!c) return true;
  const v = c.trim().toLowerCase();
  return v === "#000000" || v === "#000" || v === "black" || v === "rgb(0,0,0)" || v === "rgb(0, 0, 0)";
}

export interface ThemeDecorPlan {
  decor: SlideObjectWire[];
}

/**
 * The decor SlideRenderer would paint for this slide, or null when none. Also
 * null when the slide carries its OWN background (bgImageUrl / a custom colour):
 * those keep their decor in-slide (the persistent layer can't sit between the
 * slide's own opaque background and its text).
 */
export function themeDecorPlan(slide: SlidePayload, appearance: ThemeAppearance | null | undefined, f: ThemeDecorFlags): ThemeDecorPlan | null {
  if (slide.kind !== "text" || slide.scriptureLayout === "lowerThird") return null;
  if (slide.bgImageUrl || !isDefaultSlideBg(slide.bgColor)) return null;
  const wrap = (d: SlideObjectWire[] | undefined) => (d ? { decor: d } : null);
  const objects = slide.objects;
  if (objects && objects.length > 0) {
    const visible = objects.filter((o) => !o.hidden);
    const soleText = visible.length === 1 && visible[0].kind === "text" ? visible[0] : null;
    const hasRoleVerse = visible.some((o) => o.kind === "text" && o.role === "verse");
    const isThemeScripture = hasRoleVerse && visible.every((o) => o.kind === "text" && (o.role === "verse" || o.role === "reference"));
    if (isThemeScripture) {
      // Not allowed ⇒ SlideRenderer re-renders a plain slide with the same flags,
      // which is also not allowed ⇒ no decor.
      return wrap(themeDecorFor(appearance, true, f));
    }
    if (soleText && (soleText.text.trim() || f.editable)) {
      return slide.reference ? null : wrap(themeDecorFor(appearance, false, f));
    }
    if (coversCanvas(objects)) return null;
    return wrap(themeDecorFor(appearance, !!slide.reference?.trim(), f));
  }
  return wrap(themeDecorFor(appearance, !!slide.reference?.trim(), f));
}
