// Maps a stored church Theme `config` (jsonb, the ThemeConfig shape written by
// actions.ts) to the render-focused ThemeAppearance carried on OutputState.
//
// Every field is validated to the SAME rules as isValidThemeAppearance so the
// result is guaranteed to pass the wire validator — otherwise a malformed
// config would make the projector reject the whole OutputState and not update.
// Client-safe (no server imports); usable in the operator and in previews.
import type { ThemeAppearance } from "@/lib/broadcast";

const COLOR_RE = /^(?:#[0-9a-fA-F]{3,8}|rgba?\(\s*\d+(?:\s*,\s*\d+){2}\s*(?:,\s*(?:0|1|0?\.\d+))?\s*\))$/;
const FONT_FAMILY_RE = /^[a-zA-Z0-9 ,._'"-]{1,120}$/;

const isColor = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 32 && COLOR_RE.test(v.trim());

// Must be a subset of the wire validator (isValidMediaUrl + the bgImageUrl
// char guard in isValidThemeAppearance) so a mapped appearance ALWAYS passes
// the wire check — otherwise one bad stored URL freezes the projector (the
// whole OutputState would be rejected). Uses new URL() parsing (not a prefix
// regex) to match the validator exactly, restricted to https + no CSS-url()
// breakout chars.
const isHttpsUrl = (v: unknown): v is string => {
  if (typeof v !== "string" || v.length === 0 || v.length > 2048) return false;
  if (/["'\s<>\\]/.test(v)) return false;
  try { return new URL(v).protocol === "https:"; } catch { return false; }
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * Returns a validated ThemeAppearance, or null if the config yields nothing
 * meaningful (so callers can emit `appearance: null` = built-in defaults).
 */
export function themeConfigToAppearance(config: unknown): ThemeAppearance | null {
  if (!config || typeof config !== "object") return null;
  const c = config as Record<string, unknown>;
  const a: ThemeAppearance = {};

  // ── Background ──
  if (c.bgType === "image" && isHttpsUrl(c.bgImageUrl)) {
    a.bgType = "image";
    a.bgImageUrl = c.bgImageUrl;
  } else if (c.bgType === "gradient") {
    a.bgType = "gradient";
  } else if (c.bgType === "solid" || c.bgType === undefined) {
    a.bgType = "solid";
  } else {
    // video/camera etc. not yet rendered — fall back to a solid color
    a.bgType = "solid";
  }
  if (isColor(c.bgColor)) a.bgColor = c.bgColor.trim();
  if (isColor(c.bgColor2)) a.bgColor2 = c.bgColor2.trim();
  if (typeof c.bgAngle === "number" && Number.isFinite(c.bgAngle)) a.bgAngle = clamp(c.bgAngle, 0, 360);
  if (typeof c.dim === "number" && Number.isFinite(c.dim)) a.dim = clamp(c.dim, 0, 1);

  // ── Text ──
  if (isColor(c.textColor)) a.textColor = c.textColor.trim();
  if (typeof c.fontFamily === "string" && FONT_FAMILY_RE.test(c.fontFamily)) a.fontFamily = c.fontFamily;
  if (typeof c.fontWeight === "number" && Number.isFinite(c.fontWeight)) a.fontWeight = clamp(Math.round(c.fontWeight), 100, 900);
  if (typeof c.textShadow === "boolean") a.textShadow = c.textShadow;
  if (c.align === "left" || c.align === "center" || c.align === "right") a.align = c.align;

  // Nothing meaningful beyond the implicit bgType:"solid"? Treat as no theme.
  const meaningful =
    a.bgColor || a.bgImageUrl || a.textColor || a.fontFamily ||
    a.fontWeight !== undefined || a.textShadow !== undefined || a.align || a.bgType === "gradient" || a.dim !== undefined;
  return meaningful ? a : null;
}
