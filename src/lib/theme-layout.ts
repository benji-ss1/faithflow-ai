// Theme Editor (PP7-style) — pure validators for the theme-owned layout and the
// new numeric theme keys. Server-side sanitizeThemeConfig (actions.ts) calls
// these; kept dependency-light (no DB, no React) so tests import them directly.
//
// Layout shape (version 3):
//   { version: 3, slides: [{ id, name, role?: "lyrics"|"scripture",
//                           bgColor?, bgImageUrl?, objects: SlideObject[] }] }
// Policy: drop only the INVALID parts (a bad object, a bad url, a bad colour),
// never the whole layout — unless the result is oversized, in which case the
// layout is rejected entirely (the flat theme keys still save).
import { isValidSlideObject, MAX_SLIDE_OBJECTS } from "./broadcast";
import { cleanRenderUrl } from "./render-url";

export const THEME_LAYOUT_VERSION = 3;
export const MAX_THEME_LAYOUT_SLIDES = 12;
export const MAX_THEME_LAYOUT_BYTES = 256 * 1024;

export type ThemeTextRole = "main" | "verse" | "reference";
export type ThemeSlideRole = "lyrics" | "scripture";

export type ThemeLayoutSlide = {
  id: string;
  name: string;
  role?: ThemeSlideRole;
  bgColor?: string;
  bgImageUrl?: string;
  objects: Record<string, unknown>[];
};
export type ThemeLayout = { version: 3; slides: ThemeLayoutSlide[] };

const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\))$/;
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const POLLUTION = new Set(["__proto__", "constructor", "prototype"]);

export function isThemeColor(v: unknown): v is string {
  return typeof v === "string" && v.length <= 64 && COLOR_RE.test(v.trim());
}

function hasPollution(o: object): boolean {
  return Object.keys(o).some((k) => POLLUTION.has(k));
}

/** Validate/clean one slide object. Returns a fresh plain object or null. */
function cleanObject(o: unknown): Record<string, unknown> | null {
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  if (hasPollution(o)) return null;
  const src = o as Record<string, unknown>;
  // Copy into a null-safe plain object (JSON round-trip drops functions/symbols).
  let copy: Record<string, unknown>;
  try { copy = JSON.parse(JSON.stringify(src)) as Record<string, unknown>; } catch { return null; }
  if (!copy || typeof copy !== "object") return null;
  if (typeof copy.id !== "string" || !ID_RE.test(copy.id)) return null;
  if (copy.kind === "image" || copy.kind === "video") {
    const url = cleanRenderUrl(copy.url);
    if (!url) return null;
    copy.url = url;
  }
  // The text-box role is theme-editor metadata; anything else is removed.
  if (copy.role !== undefined) {
    if (copy.kind !== "text" || !["main", "verse", "reference"].includes(copy.role as string)) delete copy.role;
  }
  if (!isValidSlideObject(copy)) return null;
  return copy;
}

/**
 * Sanitize a theme layout. Returns undefined when the input is not a usable
 * layout (wrong shape/version, or oversized after cleaning).
 */
export function sanitizeThemeLayout(input: unknown): ThemeLayout | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  if (hasPollution(input)) return undefined;
  const obj = input as Record<string, unknown>;
  if (obj.version !== THEME_LAYOUT_VERSION || !Array.isArray(obj.slides)) return undefined;
  const slides: ThemeLayoutSlide[] = [];
  const seen = new Set<string>();
  for (const raw of obj.slides.slice(0, MAX_THEME_LAYOUT_SLIDES)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || hasPollution(raw)) continue;
    const s = raw as Record<string, unknown>;
    if (typeof s.id !== "string" || !ID_RE.test(s.id) || seen.has(s.id)) continue;
    seen.add(s.id);
    const out: ThemeLayoutSlide = {
      id: s.id,
      name: typeof s.name === "string" && s.name.trim() ? s.name.trim().slice(0, 60) : "Slide",
      objects: [],
    };
    if (s.role === "lyrics" || s.role === "scripture") out.role = s.role;
    if (isThemeColor(s.bgColor)) out.bgColor = (s.bgColor as string).trim();
    if (s.bgImageUrl !== undefined && s.bgImageUrl !== null && s.bgImageUrl !== "") {
      const u = cleanRenderUrl(s.bgImageUrl);
      if (u) out.bgImageUrl = u;
    }
    const objs = Array.isArray(s.objects) ? s.objects : [];
    for (const o of objs) {
      if (out.objects.length >= MAX_SLIDE_OBJECTS) break;
      const c = cleanObject(o);
      if (c) out.objects.push(c);
    }
    slides.push(out);
  }
  const layout: ThemeLayout = { version: 3, slides };
  if (JSON.stringify(layout).length > MAX_THEME_LAYOUT_BYTES) return undefined;
  return layout;
}

/** A finite number clamped into [min,max], or undefined when not a number. */
export function clampThemeNumber(v: unknown, min: number, max: number): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return Math.min(max, Math.max(min, v));
}

/** Numeric theme keys and their allowed ranges (values are clamped). A 0 or
 *  NaN font size baked into every song made lyrics vanish — never persist one. */
export const THEME_NUMBER_RANGES: Record<string, [number, number]> = {
  bgAngle: [0, 360],
  dim: [0, 1],
  logoOpacity: [0, 1],
  fontSizePx: [12, 400],
  fontSizeScripturePx: [12, 400],
  fontWeight: [100, 900],
};

/** Clamp a numeric theme key. undefined → reject (non-number / NaN). */
export function sanitizeThemeNumber(key: string, v: unknown): number | undefined {
  const r = THEME_NUMBER_RANGES[key];
  if (!r) return undefined;
  const n = clampThemeNumber(v, r[0], r[1]);
  return n === undefined ? undefined : key === "fontWeight" || key.startsWith("fontSize") ? Math.round(n) : n;
}
