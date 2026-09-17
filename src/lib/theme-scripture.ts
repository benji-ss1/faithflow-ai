// Theme → Projector (PR 2): a theme's scripture options → a scripture design.
//
// Decision 4 (signed off 2026-09-17): a SAVED Scripture Style (per machine)
// always wins. Theme scripture options apply only when there is no saved style
// AND the theme explicitly opts in. Pure + client-safe (no React, no storage).
//
// Opt-in rule (no regression for existing themes): the legacy ThemesManager
// seeds every new theme with scriptureShowReference:true,
// scriptureReferencePosition:"above" and fontSizeScripturePx:56, and those
// values never reached the projector. So those DEFAULT values are NOT an
// opt-in. A theme opts in when it has a scripture layout slide (its decor and
// boxes then style scripture), or explicitly turns the reference/translation off, or picks the
// "below"/"inline" reference position.
import type { ThemeFrameWire } from "./broadcast";
import type { ScriptureDesign, TextStyle } from "@/components/operator/scripture/scriptureStyle";
import { themeLayoutFromConfig } from "./theme-appearance";

export type ThemeReferencePosition = "above" | "below" | "inline";

export type ThemeScriptureOptions = {
  verse?: ThemeFrameWire;
  reference?: ThemeFrameWire;
  fontSizePx?: number;
  showReference: boolean;
  showTranslation: boolean;
  position: ThemeReferencePosition;
};

const CANVAS_H = 1080;

/** Theme config → scripture options, or null when the theme doesn't opt in. */
export function themeScriptureOptions(cfg: unknown): ThemeScriptureOptions | null {
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return null;
  const c = cfg as Record<string, unknown>;
  const layout = themeLayoutFromConfig(c);
  const verse = layout?.scripture?.verse;
  const showReference = c.scriptureShowReference !== false;
  const showTranslation = c.scriptureTranslationVisible !== false;
  const position: ThemeReferencePosition =
    c.scriptureReferencePosition === "below" || c.scriptureReferencePosition === "inline" ? c.scriptureReferencePosition : "above";
  const rawLayout = c.layout as { version?: unknown; slides?: unknown } | undefined;
  const hasScriptureSlide = !!rawLayout && rawLayout.version === 3 && Array.isArray(rawLayout.slides)
    && rawLayout.slides.some((sl) => !!sl && typeof sl === "object" && (sl as { role?: unknown }).role === "scripture");
  const optedIn = !!verse
    || hasScriptureSlide
    || c.scriptureShowReference === false
    || c.scriptureTranslationVisible === false
    || c.scriptureReferencePosition === "below"
    || c.scriptureReferencePosition === "inline";
  if (!optedIn) return null;
  const out: ThemeScriptureOptions = { showReference, showTranslation, position };
  if (verse) out.verse = verse;
  if (layout?.scripture?.reference) out.reference = layout.scripture.reference;
  const fs = c.fontSizeScripturePx;
  if (typeof fs === "number" && Number.isFinite(fs) && fs >= 12 && fs <= 400) out.fontSizePx = Math.round(fs);
  return out;
}

function styleFromFrame(base: TextStyle, f: ThemeFrameWire): TextStyle {
  return {
    ...base,
    x: f.x, y: f.y, w: f.w, h: f.h,
    ...(f.fontFamily ? { fontFamily: f.fontFamily } : {}),
    ...(typeof f.fontSize === "number" ? { fontSize: f.fontSize } : {}),
    ...(typeof f.fontWeight === "number" ? { fontWeight: f.fontWeight } : {}),
    ...(f.color ? { color: f.color } : {}),
    ...(f.align ? { align: f.align } : {}),
    ...(typeof f.italic === "boolean" ? { italic: f.italic } : {}),
    ...(typeof f.uppercase === "boolean" ? { uppercase: f.uppercase } : {}),
    ...(typeof f.shadow === "boolean" ? { shadow: f.shadow } : {}),
  };
}

/**
 * Options → a FULLSCREEN ScriptureDesign built on `base` (the built-in default
 * design). Verse box/size from the theme layout (else fontSizeScripturePx);
 * reference box from the layout, else placed above/below the verse.
 */
export function designFromThemeScripture(opts: ThemeScriptureOptions, base: ScriptureDesign): ScriptureDesign {
  let verse: TextStyle = { ...base.verse };
  if (opts.verse) verse = styleFromFrame(verse, opts.verse);
  else if (opts.fontSizePx) verse.fontSize = opts.fontSizePx;
  let reference: TextStyle = { ...base.reference };
  if (opts.reference) {
    reference = styleFromFrame(reference, opts.reference);
  } else if (opts.position === "above" && opts.showReference) {
    // Reference line at the top; the default verse box moves down under it.
    reference = { ...reference, y: 40 };
    if (!opts.verse) verse = { ...verse, y: 40 + reference.h + 20, h: CANVAS_H - (40 + reference.h + 20) - 60 };
  }
  return {
    layout: "fullscreen",
    verse,
    reference: { ...reference, show: opts.showReference, showTranslation: opts.showTranslation },
    band: { ...base.band },
  };
}
