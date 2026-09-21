"use client";
/**
 * KEEP THE THEME'S BACKGROUND WHEN THE SLIDE LAYER IS CLEARED (owner decision
 * 2026-09-19: "When you clear the Slide layer, a theme's background image should
 * stay on screen, as in ProPresenter; only the words go").
 *
 * ProPresenter treats a theme's Theme-tab media as the MEDIA layer, so Clear
 * Slide (F2 / rail Slide / Layers-panel Slide row) leaves it, while Clear Media
 * (F3 / rail Media / panel Media row) and Clear All remove it.
 *
 * MECHANISM (deliberately small): a Slide clear that happens while something is
 * live and its theme carries media does NOT send a plain `{kind:"empty"}`. It
 * sends `{kind:"empty", keepThemeBg:true}` instead — same identity ("e", so the
 * empty->empty transition can never replay = no fade-pulse) — and the operator
 * keeps emitting the LAST LIVE appearance instead of falling back to the default
 * theme. Every output renders through the shared OutputCompositor +
 * SlideRenderer, so the flag rides the existing slide wire to /live, /stage,
 * /livestream, /ndi, the preview and the MultiView tiles with no per-route
 * plumbing. SlideRenderer's empty branch paints the theme background (no words)
 * only when the flag is set AND the surface is not an alpha key and nothing else
 * (a background template / camera) is behind — so OBS/NDI transparent output is
 * exactly as before.
 *
 * KILL SWITCH — restores the old behaviour instantly, no rebuild:
 *   - `NEXT_PUBLIC_PP7_KEEP_THEME_BG=0`             -> everyone (needs a deploy)
 *   - localStorage `presentflow.pp7KeepThemeBg.v1`  -> "0" off / "1" on, this
 *     machine, read live (a `storage` event reaches open windows)
 *   - turning the whole PP7 layer UI off also turns this off.
 * With it off the operator never emits the flag, and the compositor strips it
 * from anything it receives, so the render is byte-identical to before.
 */
import { useEffect, useState } from "react";
import type { SlidePayload, ThemeAppearance } from "./broadcast";
import { themeHasDecor } from "./theme-decor-plan";
import { coversCanvas } from "./slide-objects";
import { readPp7LayersFlag, PP7_LAYERS_STORAGE_KEY } from "./pp7-layers-flag";

export const PP7_KEEP_THEME_BG_STORAGE_KEY = "presentflow.pp7KeepThemeBg.v1";

export function readPp7KeepThemeBgFlag(): boolean {
  // The PP7 layer stack is the parent feature — no rail, no PP7 clears.
  if (!readPp7LayersFlag()) return false;
  try {
    const local = window.localStorage.getItem(PP7_KEEP_THEME_BG_STORAGE_KEY);
    if (local === "1") return true;
    if (local === "0") return false;
  } catch { /* storage unavailable */ }
  return process.env.NEXT_PUBLIC_PP7_KEEP_THEME_BG !== "0";
}

/** Mount-read (never during SSR/first paint) + live to both kill switches. */
export function usePp7KeepThemeBg(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const read = () => setOn(readPp7KeepThemeBgFlag());
    read();
    const onStorage = (e: StorageEvent) => {
      if (e.key === PP7_KEEP_THEME_BG_STORAGE_KEY || e.key === PP7_LAYERS_STORAGE_KEY) read();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return on;
}

/** True for the "slide layer cleared but the theme background stays" slide. */
export function isKeepThemeBgSlide(s: SlidePayload | null | undefined): boolean {
  return !!s && s.kind === "empty" && s.keepThemeBg === true;
}

/**
 * Does this theme carry MEDIA that ProPresenter would keep on the Media layer?
 * An image or video background, an animated background, or theme decor
 * (images/shapes/video on the theme slide).
 *
 * A plain solid colour or gradient is deliberately NOT retained: in
 * ProPresenter a slide's background colour belongs to the slide, so it goes with
 * Clear Slide; and keeping a colour would light the Media row (and need a Clear
 * Media to reach black) for every church whose theme is just a coloured fill.
 */
export function themeMediaRetainable(a: ThemeAppearance | null | undefined): boolean {
  if (!a) return false;
  if (a.bgType === "image" && !!a.bgImageUrl) return true;
  if (a.bgType === "video" && !!a.bgVideoUrl) return true;
  if (!!a.bgAnimation && a.bgAnimation !== "none" && a.bgType !== "image" && a.bgType !== "video") return true;
  return themeHasDecor(a);
}

function defaultBlack(c: string | undefined): boolean {
  if (!c) return true;
  const v = c.trim().toLowerCase();
  return v === "#000000" || v === "#000" || v === "black" || v === "rgb(0,0,0)" || v === "rgb(0, 0, 0)";
}

const normColor = (c: string | undefined) => (c ?? "").trim().toLowerCase();

/** Was the THEME background actually what showed behind this live slide? A slide
 *  with its OWN background (a different image / colour / a designed full-canvas
 *  layout) owns its pixels — that media is "baked into the slide" and clears with
 *  it. BUT applying a theme to a song bakes the THEME's own background into every
 *  slide (src/lib/theme-bake.ts: the theme's image URL, its colour, or the
 *  near-black "#010101" nudge), and that is the theme's media, not the slide's:
 *  a baked slide whose image/colour IS the live theme's still counts. */
function themeBgWasShowing(s: SlidePayload, appearance: ThemeAppearance | null | undefined): boolean {
  // `bgExplicit` (2026-09-21) says the colour was deliberately CHOSEN. A theme
  // bake sets it too, so "chosen" alone proves nothing — but it does mean we can
  // stop treating a bare black as automatically the theme's: if it was chosen and
  // does NOT match the live theme, it is the slide's own and clears with it.
  const chosen = s.kind === "text" && s.bgExplicit === true;
  const matchesTheme = (c: string | undefined) => !!appearance?.bgColor && normColor(c) === normColor(appearance.bgColor);
  const isThemeColor = (c: string | undefined) =>
    chosen ? matchesTheme(c) : (defaultBlack(c) || normColor(c) === "#010101" || matchesTheme(c));
  if (s.kind === "blank") return defaultBlack(s.bgColor);
  if (s.kind !== "text") return false; // image / video / logo / empty
  if (s.bgImageUrl) {
    // The image must be the live theme's own (baked), else it is the slide's.
    if (!(appearance?.bgType === "image" && appearance.bgImageUrl === s.bgImageUrl)) return false;
  } else if (!isThemeColor(s.bgColor)) {
    return false;
  }
  // A designed slide whose first object covers the canvas hides the theme behind
  // it — the same rule themeDecorPlan() uses.
  if (s.objects && s.objects.length > 0 && coversCanvas(s.objects)) return false;
  return true;
}

export type SlideClearInputs = {
  /** What is live right now. */
  prev: SlidePayload;
  /** The appearance that was live (the emitted one). */
  appearance: ThemeAppearance | null | undefined;
  /** Kill switch + parent flag, already resolved. */
  enabled: boolean;
  /** A global Background Template is showing (it already survives a Slide clear,
   *  and the theme background is hidden behind it). */
  backgroundTemplateActive: boolean;
  /** A live camera is behind the slide (the theme background is not painted). */
  cameraActive: boolean;
};

/**
 * What a PP7 Slide clear does:
 *   - "keep":  send empty+keepThemeBg and retain the live appearance
 *   - "noop":  already empty with the theme kept — pressing F2 again must NOT
 *              drop the theme background (only Clear Media / Clear All do)
 *   - "plain": today's behaviour (plain empty, appearance falls back to default)
 * Idle (nothing ever sent / already empty) is always "plain" => stays black.
 */
export function decideSlideClear(i: SlideClearInputs): "keep" | "noop" | "plain" {
  if (!i.enabled) return "plain";
  if (isKeepThemeBgSlide(i.prev)) return "noop";
  if (i.backgroundTemplateActive || i.cameraActive) return "plain";
  if (!themeBgWasShowing(i.prev, i.appearance)) return "plain";
  if (!themeMediaRetainable(i.appearance)) return "plain";
  return "keep";
}

/** The appearance the outputs should emit: the retained (last live) one while
 *  the slide layer is empty-with-theme-kept, otherwise the normal one. */
export function pickOutputAppearance(
  live: SlidePayload,
  retained: ThemeAppearance | null,
  effective: ThemeAppearance | null,
): ThemeAppearance | null {
  return isKeepThemeBgSlide(live) && retained ? retained : effective;
}
