// Theme config shape + server-side whitelist sanitizer. PURE (no DB, no
// "use server") so actions.ts, built-in themes and tests share one copy.
// Moved verbatim from actions.ts (behaviour identical) + the "builtinId" key.
import { sanitizeThemeLayout, sanitizeThemeNumber, THEME_NUMBER_RANGES, type ThemeLayout } from "./theme-layout";
import { cleanRenderUrl } from "./render-url";
import { isBuiltinThemeId } from "./builtin-themes";
import { sanitizeBandStyle, type BandStyle, type ScriptureLayout } from "./scripture-design";

// Extended per Section 4 of the visual-overhaul brief. Existing fields kept
// so applyThemeToSong (which reads a subset) keeps working. New fields are
// pure additive — the operator projector uses whatever's defined and falls
// back to defaults elsewhere. downstream operator surface will pick these
// up in its own commit; the editor UI can already read/write them today.
export type ThemeConfig = {
  // Typography
  fontFamily?: string;                    // headline (also song lyrics for now)
  fontBodyFamily?: string;                // body / caption
  fontSizePx?: number;                    // lyrics size
  fontSizeScripturePx?: number;           // scripture verse size
  fontWeight?: number;                    // headline / lyrics weight
  textColor?: string;
  textShadow?: boolean;
  align?: "left" | "center" | "right";
  // Background
  bgType?: "solid" | "gradient" | "image" | "video";
  bgColor?: string;                       // solid + gradient stop 1
  bgColor2?: string;                      // gradient stop 2
  bgImageUrl?: string;                    // used when bgType === "image"
  bgVideoUrl?: string;                    // used when bgType === "video" (autoplay muted loop)
  bgOpacity?: number;                     // 0..1
  bgAnimation?: "none" | "drift" | "aurora" | "pulse"; // Themes 3: motion for solid/gradient bg
  // Layout
  logoPosition?:
    | "top-left" | "top-center" | "top-right"
    | "middle-left" | "middle-center" | "middle-right"
    | "bottom-left" | "bottom-center" | "bottom-right"
    | "none";
  logoSizePx?: number;
  logoUrl?: string;                        // church-uploaded logo image (presigned GET URL)
  churchNameVisible?: boolean;
  churchNamePosition?: "top" | "bottom";
  // Lower third
  lowerThirdEnabled?: boolean;
  lowerThirdStyle?: "bar" | "gradient-fade" | "minimal";
  lowerThirdColor?: string;
  // Scripture
  scriptureShowReference?: boolean;
  scriptureReferencePosition?: "above" | "below" | "inline";
  scriptureTranslationVisible?: boolean;
  /** 2026-09-22 fix: a theme may carry the lower-third BAND for scripture, not just
   *  a full-screen layout. `theme-scripture.ts` has read these two keys since the
   *  0.1.490 "themes can use the Third band" ship, but they were never in
   *  THEME_ALLOWED_KEYS, so sanitizeThemeConfig stripped them on EVERY write and the
   *  ThemeEditorTab "Full screen / Third band" control silently did nothing.
   *  Absent ⇒ fullscreen, exactly as before. A saved church Scripture Style still wins. */
  scriptureLayout?: ScriptureLayout;
  scriptureBand?: BandStyle;
  // Transitions (existing "transition" kept for backwards compat; simpler
  // pair below is what the editor UI reads/writes)
  transition?: { effectId: string; durationMs: number; easing: string };
  transitionType?: "fade" | "slide" | "none";
  transitionDurationMs?: number;
  // Layout misc
  safeArea?: boolean;
  // Theme Editor (PR 1) — PP7-style multi-slide layout + extra look controls.
  // Saved now; the projector reads layout/scripture/transition in PR 2.
  layout?: ThemeLayout;
  bgAngle?: number;                        // gradient angle 0..360
  dim?: number;                            // background dim 0..1
  logoOpacity?: number;                    // 0..1
  // Built-in themes — the "builtin:<slug>" this church theme was materialized
  // from (dedupe key). Validated against the built-in list.
  builtinId?: string;
};

export const THEME_ALLOWED_KEYS: (keyof ThemeConfig)[] = [
  "fontFamily", "fontBodyFamily", "fontSizePx", "fontSizeScripturePx",
  "fontWeight", "textColor", "textShadow", "align",
  "bgType", "bgColor", "bgColor2", "bgImageUrl", "bgVideoUrl", "bgOpacity", "bgAnimation",
  "logoPosition", "logoSizePx", "logoUrl", "churchNameVisible", "churchNamePosition",
  "lowerThirdEnabled", "lowerThirdStyle", "lowerThirdColor",
  "scriptureShowReference", "scriptureReferencePosition", "scriptureTranslationVisible",
  "scriptureLayout", "scriptureBand",
  "transition", "transitionType", "transitionDurationMs",
  "safeArea",
  "layout", "bgAngle", "dim", "logoOpacity",
  "builtinId",
];

/**
 * `allowBuiltinId` (review fix): ONLY materializeBuiltinTheme may persist
 * `builtinId`. Every other writer (create/update/import/duplicate) silently
 * strips it, so a user theme can never impersonate or hijack a built-in's
 * find-or-create slot.
 */
export function stripBuiltinId(config: Record<string, unknown>): Record<string, unknown> {
  if (!config || typeof config !== "object" || !("builtinId" in config)) return config;
  const { builtinId: _b, ...rest } = config; void _b;
  return rest;
}

/**
 * Merge a FIELD-LEVEL patch onto a stored theme config.
 *
 * Pure half of `patchThemeConfig` (actions.ts), which applies it inside a
 * transaction so two concurrent control changes are last-write-wins PER FIELD
 * rather than per whole blob.
 *
 * `undefined` means "leave this field alone"; `null` means "clear it". Callers
 * MUST still run the result through sanitizeThemeConfig — this helper does no
 * validation, it only decides which keys survive.
 */
export function mergeThemeConfigPatch(
  prev: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(prev ?? {}) };
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (v === undefined) continue;
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out;
}

export function sanitizeThemeConfig(input: unknown, opts: { allowBuiltinId?: boolean } = {}): { config: ThemeConfig; rejected: string[] } {
  const rejected: string[] = [];
  const out: ThemeConfig = {};
  if (!input || typeof input !== "object") return { config: out, rejected };
  const obj = input as Record<string, unknown>;
  // The three URL-bearing theme fields render straight into an output channel
  // (logo, slide background image, background video), so value-validate them
  // with the SAME scheme/length check as a dropped media URL — an off-scheme or
  // oversized value is rejected rather than persisted onto the theme.
  const URL_KEYS = new Set(["logoUrl", "bgImageUrl", "bgVideoUrl"]);
  for (const k of Object.keys(obj)) {
    if ((THEME_ALLOWED_KEYS as string[]).includes(k)) {
      if (k === "builtinId") {
        if (obj[k] === undefined || obj[k] === null || !opts.allowBuiltinId) continue;
        if (isBuiltinThemeId(obj[k])) out.builtinId = obj[k] as string; else rejected.push(k);
      } else if (k === "layout") {
        // Dedicated validator: objects via isValidSlideObject, urls via
        // cleanRenderUrl, capped slides/objects/bytes. Invalid parts dropped.
        if (obj[k] === undefined || obj[k] === null) continue;
        const layout = sanitizeThemeLayout(obj[k]);
        if (layout) out.layout = layout; else rejected.push(k);
      } else if (k === "scriptureLayout") {
        // Only the two known layouts persist; anything else is rejected rather
        // than written through (this value picks a whole projector design).
        if (obj[k] === undefined || obj[k] === null) continue;
        if (obj[k] === "fullscreen" || obj[k] === "lowerThird") out.scriptureLayout = obj[k] as ScriptureLayout;
        else rejected.push(k);
      } else if (k === "scriptureBand") {
        // Clamped by the SAME sanitizer a saved church Scripture Style uses, so a
        // hand-edited or corrupted theme can never put an invalid band on the wire.
        if (obj[k] === undefined || obj[k] === null) continue;
        if (typeof obj[k] === "object" && !Array.isArray(obj[k])) out.scriptureBand = sanitizeBandStyle(obj[k]);
        else rejected.push(k);
      } else if (k in THEME_NUMBER_RANGES) {
        // bgAngle/dim/logoOpacity + font size/weight: clamped (a 0/NaN font
        // size baked into songs made lyrics vanish).
        if (obj[k] === undefined || obj[k] === null) continue;
        const n = sanitizeThemeNumber(k, obj[k]);
        if (n === undefined) rejected.push(k); else (out as Record<string, unknown>)[k] = n;
      } else if (URL_KEYS.has(k) && obj[k] !== undefined && obj[k] !== null && obj[k] !== "") {
        const clean = cleanRenderUrl(obj[k]);
        if (clean) {
          (out as Record<string, unknown>)[k] = clean;
        } else {
          rejected.push(k);
        }
      } else {
        (out as Record<string, unknown>)[k] = obj[k];
      }
    } else {
      rejected.push(k);
    }
  }
  return { config: out, rejected };
}
