/**
 * Layer Order V3 — pure theme-layer helpers (node-testable, no React).
 * The theme LAYER is only the theme's background (colour / gradient / image /
 * video / animation / dim / see-through). Text styling, logo and layout are not
 * part of it, so hiding the theme layer keeps them.
 *
 * Semantics (never mix these up):
 *   - `dim` (theme editor "Opacity" slider = config `bgOpacity`, mapped to
 *     `dim = 1 − bgOpacity`) is a BLACK OVERLAY inside the theme layer — the
 *     layer stays opaque. Identical to legacy.
 *   - `layerOpacity` (V3 only, 0..1, default 1) is real SEE-THROUGH of the whole
 *     theme-bg layer: the media layer underneath shows.
 */
import type { SlidePayload, ThemeAppearance } from "@/lib/broadcast";
import { slideOutputIdentity } from "@/lib/broadcast";

const THEME_BG_KEYS = ["bgType", "bgColor", "bgColor2", "bgAngle", "bgImageUrl", "bgVideoUrl", "bgAnimation", "dim", "layerOpacity"] as const;

/** The appearance with its background removed (the theme layer cleared). */
export function stripThemeBackground(a: ThemeAppearance | null | undefined): ThemeAppearance | null {
  if (!a) return a ?? null;
  const out: Record<string, unknown> = { ...a };
  for (const k of THEME_BG_KEYS) delete out[k];
  return out as ThemeAppearance;
}

/** Theme-layer see-through 0..1 (`layerOpacity`); anything invalid ⇒ 1. */
export function themeLayerOpacity(a: ThemeAppearance | null | undefined): number {
  const o = a?.layerOpacity;
  return typeof o === "number" && Number.isFinite(o) ? Math.max(0, Math.min(1, o)) : 1;
}

/** True when the theme layer would paint something (not fully transparent). */
export function themeLayerPaints(a: ThemeAppearance | null | undefined): boolean {
  if (!a) return false;
  if (themeLayerOpacity(a) <= 0) return false;
  if (a.bgType === "video") return !!a.bgVideoUrl;
  if (a.bgType === "image") return !!a.bgImageUrl;
  return !!a.bgColor;
}

/** A colour that carries its own alpha (#rgba / #rrggbbaa / rgba()/hsla()). */
function hasAlpha(c: string | undefined): boolean {
  if (!c) return true;
  const v = c.trim().toLowerCase();
  if (v === "transparent") return true;
  if (/^#([0-9a-f]{4}|[0-9a-f]{8})$/.test(v)) return true;
  return /^(rgba|hsla)\(/.test(v);
}

/**
 * True when the theme layer, while shown, FULLY COVERS whatever is below it
 * (media / camera) — so an underlying <video> can be paused (never reset) to
 * save decode. Conservative: an image (may have alpha), an animated bg, or any
 * colour with alpha is treated as not covering.
 */
export function themeLayerCovers(a: ThemeAppearance | null | undefined): boolean {
  if (!themeLayerPaints(a) || themeLayerOpacity(a) < 1) return false;
  if (a!.bgType === "video") return true;
  if (a!.bgType === "image") return false;
  if (a!.bgAnimation && a!.bgAnimation !== "none") return false;
  if (a!.bgType === "gradient") return !hasAlpha(a!.bgColor) && !hasAlpha(a!.bgColor2 ?? a!.bgColor);
  return !hasAlpha(a!.bgColor);
}

/**
 * The theme layer belongs to the PRESENTATION: it shows only while a slide is
 * live (any non-empty kind), or when a legacy keep-theme-bg retention is
 * explicitly active. Blank start / a cleared slide ⇒ hidden, media shows.
 */
export function themeLayerShownFor(slide: SlidePayload | null | undefined): boolean {
  if (!slide) return false;
  if (slide.kind !== "empty") return true;
  return (slide as { keepThemeBg?: boolean }).keepThemeBg === true;
}

/**
 * Identity that a "Hide theme for this slide" applies to. The hide is recorded
 * against this key; it lapses automatically when ANY new send goes live (the
 * operator's per-send counter `sendRev`, so A→B→A and re-sending the identical
 * chorus slide both lapse it) OR the effective theme changes (per-item /
 * content-type theme, a new plan) — no one-frame flash.
 */
export function themeHideKey(live: SlidePayload, appearance: ThemeAppearance | null | undefined, planId?: string | null, sendRev: number = 0): string {
  const bg: Record<string, unknown> = {};
  if (appearance) for (const k of THEME_BG_KEYS) if (appearance[k] !== undefined) bg[k] = appearance[k];
  let slideId = "";
  try { slideId = slideOutputIdentity(live); } catch { slideId = live.kind; }
  return `${planId ?? ""}|${sendRev}|${slideId}|${JSON.stringify(bg)}`;
}

/**
 * PENDING-DECISION SWITCH (Victor 2026-09-24 chose option (a) ⇒ false).
 * false: Clear Slide removes the words; the theme layer hides WITH the slide
 *        (it belongs to the presentation) and shows again on the next slide.
 * true:  Clear Slide ALSO turns the theme layer off: it stays hidden on the
 *        following slides until a theme is (re)applied.
 */
export const clearSlideAlsoClearsTheme = false;

/** What Clear Slide does to the theme layer under V3 (pure; tested for both values). */
export function clearSlideThemeEffect(alsoClearsTheme: boolean = clearSlideAlsoClearsTheme): "hide-with-slide" | "theme-off" {
  return alsoClearsTheme ? "theme-off" : "hide-with-slide";
}
