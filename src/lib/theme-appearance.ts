// Maps a stored church Theme `config` (jsonb, the ThemeConfig shape written by
// actions.ts) to the render-focused ThemeAppearance carried on OutputState.
//
// Every field is validated to the SAME rules as isValidThemeAppearance so the
// result is guaranteed to pass the wire validator — otherwise a malformed
// config would make the projector reject the whole OutputState and not update.
// Client-safe (no server imports); usable in the operator and in previews.
import { isValidThemeLayoutWire, isValidThemeDecorObject, MAX_THEME_DECOR_OBJECTS, THEME_LAYOUT_WIRE_MAX_BYTES, type ThemeAppearance, type ThemeFrameWire, type ThemeLayoutWire, type SlideObjectWire } from "@/lib/broadcast";
import { isRenderableUrl } from "./render-url";
import { mainTextOf, verseTextOf } from "./theme-editor-model";
import type { SlideObject, TextObject } from "./slide-objects";
import { fontStack, slideFontsV1Enabled } from "./fonts/registry";

const COLOR_RE = /^(?:#[0-9a-fA-F]{3,8}|rgba?\(\s*\d+(?:\s*,\s*\d+){2}\s*(?:,\s*(?:0|1|0?\.\d+))?\s*\))$/;
const FONT_FAMILY_RE = /^[a-zA-Z0-9 ,._'"-]{1,120}$/;

const isColor = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 32 && COLOR_RE.test(v.trim());

// Must equal the wire validator so a mapped appearance ALWAYS passes the wire
// check — otherwise one bad stored URL freezes the projector (the whole
// OutputState would be rejected). ONE URL POLICY (2026-09-14): both sides now
// call render-url.ts isRenderableUrl, so they can never drift.
const isHttpsUrl = (v: unknown): v is string => isRenderableUrl(v, { allowBlob: false });

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// Bug-fix 2026-08-11 (font mismatch): theme fonts were stored as bare family
// names ("Inter") with no generic fallback. On the projector, an unloaded
// family falls back to the renderer's DEFAULT SERIF (Times) — which operators
// read as a "medieval/old-English" font vs the clean sans preview. Append a
// generic fallback so an unavailable family degrades to the right CLASS of
// font. Known serifs get `serif`; everything else gets `sans-serif`. Families
// already carrying a comma-separated stack pass through untouched.
const KNOWN_SERIFS = new Set(["georgia", "times new roman", "times", "garamond", "palatino", "baskerville"]);
// Fonts Phase 1 (2026-09-17): the registry's fontStack is now the source of truth
// (serif display faces like Playfair/Cormorant fall back to serif, Helvetica →
// Helvetica Neue/Arial on Windows). The kill switch restores the legacy mapper.
function withGenericFallback(family: string): string {
  if (slideFontsV1Enabled()) {
    const out = fontStack(family) ?? family.trim();
    return out.length <= 120 ? out : legacyGenericFallback(family);
  }
  return legacyGenericFallback(family);
}
function legacyGenericFallback(family: string): string {
  const f = family.trim();
  if (f.includes(",")) return f; // already a stack
  // Strip CSS quotes before classifying ('"Times New Roman"' must map to serif).
  const bare = f.replace(/^['"]|['"]$/g, "").toLowerCase();
  const generic = KNOWN_SERIFS.has(bare) ? "serif" : "sans-serif";
  const out = `${f}, ${generic}`;
  // The wire validator caps fontFamily at 120 chars — if appending the generic
  // would overflow (only for absurdly long names), keep the original rather
  // than have the receiving validator silently drop the font entirely.
  return out.length <= 120 ? out : f;
}

const LOGO_POSITIONS = new Set([
  "top-left", "top-center", "top-right",
  "middle-left", "center", "middle-right",
  "bottom-left", "bottom-center", "bottom-right",
]);

/**
 * Returns a validated ThemeAppearance, or null if the config yields nothing
 * meaningful (so callers can emit `appearance: null` = built-in defaults).
 */
/**
 * True when a theme appearance carries its OWN projected background (a fill the
 * congregation would see), as opposed to text-only styling. Used to enforce the
 * mutually-exclusive rule between a theme background and a Background Template:
 * applying a background-bearing theme clears the active template so the theme's
 * background actually reaches the projector. A text-only theme (fonts/colour but
 * no background) returns false — it can safely coexist over a template.
 */
export function appearanceHasBackground(a: ThemeAppearance | null | undefined): boolean {
  if (!a) return false;
  if (a.bgType === "image" && a.bgImageUrl) return true;
  if (a.bgType === "video" && a.bgVideoUrl) return true;
  if (a.bgType === "gradient") return true;
  // A solid fill counts only when a real colour is set (bgType defaults to
  // "solid" even for text-only themes, so bgType alone is not enough).
  if (a.bgColor) return true;
  return false;
}

export function themeConfigToAppearance(config: unknown): ThemeAppearance | null {
  if (!config || typeof config !== "object") return null;
  const c = config as Record<string, unknown>;
  const a: ThemeAppearance = {};

  // ── Background ──
  if (c.bgType === "video" && isHttpsUrl(c.bgVideoUrl)) {
    a.bgType = "video";
    a.bgVideoUrl = c.bgVideoUrl;
  } else if (c.bgType === "image" && isHttpsUrl(c.bgImageUrl)) {
    a.bgType = "image";
    a.bgImageUrl = c.bgImageUrl;
  } else if (c.bgType === "gradient") {
    a.bgType = "gradient";
  } else if (c.bgType === "solid" || c.bgType === undefined) {
    a.bgType = "solid";
  } else {
    // camera / an unusable video URL etc. — fall back to a solid color
    a.bgType = "solid";
  }
  if (isColor(c.bgColor)) a.bgColor = c.bgColor.trim();
  if (isColor(c.bgColor2)) a.bgColor2 = c.bgColor2.trim();
  if (typeof c.bgAngle === "number" && Number.isFinite(c.bgAngle)) a.bgAngle = clamp(c.bgAngle, 0, 360);
  // Match the theme editor's live preview, which draws gradients at 135°.
  if (a.bgType === "gradient" && a.bgAngle === undefined) a.bgAngle = 135;
  // Readability dim. The theme editor exposes an "Opacity" slider stored as
  // `bgOpacity` (1 = none); reconcile it to a dark readability overlay so that
  // control actually affects the projector (dim = 1 − bgOpacity). An explicit
  // `dim` wins; video backgrounds get a default so they never wash out lyrics.
  if (typeof c.dim === "number" && Number.isFinite(c.dim)) {
    a.dim = clamp(c.dim, 0, 1);
  } else if (typeof c.bgOpacity === "number" && Number.isFinite(c.bgOpacity) && c.bgOpacity < 1) {
    a.dim = clamp(1 - c.bgOpacity, 0, 1);
  }
  if (a.bgType === "video" && (a.dim === undefined || a.dim === 0)) a.dim = 0.3;
  // Layer Order V3 "See-through" — REAL transparency of the theme-bg layer
  // (never the dim above). Only emitted when < 1 so every existing theme's
  // appearance (and therefore flag-off output) is byte-identical. Legacy
  // renderers ignore the field; only the V3 compositor reads it.
  if (typeof c.layerOpacity === "number" && Number.isFinite(c.layerOpacity) && c.layerOpacity < 1) {
    a.layerOpacity = clamp(c.layerOpacity, 0, 1);
  }
  // Themes 3 — animated background preset (solid/gradient only; ignored for
  // image/video which have their own motion). Unknown values fall through to
  // no animation.
  if ((c.bgAnimation === "drift" || c.bgAnimation === "aurora" || c.bgAnimation === "pulse")
    && a.bgType !== "image" && a.bgType !== "video") {
    a.bgAnimation = c.bgAnimation;
  }

  // ── Text ──
  if (isColor(c.textColor)) a.textColor = c.textColor.trim();
  if (typeof c.fontFamily === "string" && FONT_FAMILY_RE.test(c.fontFamily)) a.fontFamily = withGenericFallback(c.fontFamily);
  if (typeof c.fontWeight === "number" && Number.isFinite(c.fontWeight)) a.fontWeight = clamp(Math.round(c.fontWeight), 100, 900);
  if (typeof c.textShadow === "boolean") a.textShadow = c.textShadow;
  if (c.align === "left" || c.align === "center" || c.align === "right") a.align = c.align;

  // ── Logo overlay (Phase 2) ──
  if (isHttpsUrl(c.logoUrl) && c.logoPosition !== "none") {
    a.logoUrl = c.logoUrl;
    // The theme editor's 3x3 grid stores the centre cell as "middle-center" but
    // the wire contract calls it "center" — map it, or a centred logo silently
    // fell back to bottom-right.
    const pos = c.logoPosition === "middle-center" ? "center" : (c.logoPosition as string);
    a.logoPosition = LOGO_POSITIONS.has(pos) ? (pos as NonNullable<ThemeAppearance["logoPosition"]>) : "bottom-right";
    // ThemeConfig stores logoSizePx (against a ~1920 reference); the wire uses a
    // resolution-independent % of output width.
    const px = typeof c.logoSizePx === "number" && Number.isFinite(c.logoSizePx) ? c.logoSizePx : 0;
    a.logoSizePct = px > 0 ? clamp((px / 1920) * 100, 2, 50) : 12;
    if (typeof c.logoOpacity === "number" && Number.isFinite(c.logoOpacity)) a.logoOpacity = clamp(c.logoOpacity, 0, 1);
  }

  // ── Theme → Projector (PR 2): text-box layout ──
  const layout = themeLayoutFromConfig(c);
  if (layout) a.layout = layout;

  // Nothing meaningful beyond the implicit bgType:"solid"? Treat as no theme.
  const meaningful =
    !!a.layout || a.bgColor || a.bgImageUrl || a.bgVideoUrl || a.logoUrl || a.textColor || a.fontFamily ||
    a.fontWeight !== undefined || a.textShadow !== undefined || a.align || a.bgType === "gradient" || a.dim !== undefined || a.bgAnimation !== undefined;
  return meaningful ? a : null;
}

// ── Theme → Projector (PR 2) ───────────────────────────────────────────────
// The seed box the theme editor shows for a theme with no saved layout
// (theme-editor-model seedThemeSlide). Saving the editor without moving it
// must NOT turn into a projector frame — that would shrink every existing
// church's lyrics into a 400px band on its first save.
const SEED_MAIN = { id: "theme_main_text", x: 80, y: 340, w: 1760, h: 400 };
function isUnchangedSeed(t: TextObject): boolean {
  return t.id === SEED_MAIN.id && Math.round(t.x) === SEED_MAIN.x && Math.round(t.y) === SEED_MAIN.y
    && Math.round(t.w) === SEED_MAIN.w && Math.round(t.h) === SEED_MAIN.h;
}

/** A text object → a wire-valid frame, or null when unusable (hidden/tiny/NaN). */
export function frameFromTextObject(t: TextObject | null | undefined): ThemeFrameWire | null {
  if (!t || t.kind !== "text" || t.hidden) return null;
  const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  if (!fin(t.x) || !fin(t.y) || !fin(t.w) || !fin(t.h)) return null;
  if (t.w < 40 || t.h < 40) return null;
  const f: ThemeFrameWire = {
    x: Math.round(clamp(t.x, -1920, 1920)),
    y: Math.round(clamp(t.y, -1080, 1080)),
    w: Math.round(clamp(t.w, 40, 3840)),
    h: Math.round(clamp(t.h, 40, 2160)),
  };
  if (typeof t.fontFamily === "string" && FONT_FAMILY_RE.test(t.fontFamily)) {
    // Fonts P1 (2026-09-17): mirror :133 — if appending the generic pushes the
    // stack past the 120-char wire cap, keep the ORIGINAL family (it already
    // passed FONT_FAMILY_RE) instead of dropping fontFamily entirely and
    // silently losing the operator's chosen font on the projector.
    const fam = withGenericFallback(t.fontFamily);
    f.fontFamily = FONT_FAMILY_RE.test(fam) ? fam : t.fontFamily;
  }
  if (fin(t.fontSize)) f.fontSize = Math.round(clamp(t.fontSize, 8, 400));
  if (fin(t.fontWeight)) f.fontWeight = clamp(Math.round(t.fontWeight), 100, 900);
  if (isColor(t.color)) f.color = t.color.trim();
  if (t.align === "left" || t.align === "center" || t.align === "right") f.align = t.align;
  if (typeof t.italic === "boolean") f.italic = t.italic;
  if (typeof t.uppercase === "boolean") f.uppercase = t.uppercase;
  if (typeof t.shadow === "boolean") f.shadow = t.shadow;
  return f;
}

type LayoutSlide = { id?: unknown; role?: unknown; objects?: unknown; bgColor?: unknown; bgImageUrl?: unknown };

/**
 * A theme slide's decor: its background (as a full-canvas image/shape) plus
 * every visible object that is not a role text box (`exclude` = the boxes used
 * as frames). Only wire-valid objects with renderable (non-blob) URLs, compact
 * (editor-only id/locked dropped), capped at MAX_THEME_DECOR_OBJECTS.
 */
export function themeDecorFromSlide(slide: LayoutSlide | undefined, exclude: Set<unknown>): SlideObjectWire[] {
  if (!slide) return [];
  const out: SlideObjectWire[] = [];
  if (isHttpsUrl(slide.bgImageUrl)) out.push({ kind: "image", x: 0, y: 0, w: 1920, h: 1080, url: slide.bgImageUrl, fit: "cover" });
  else if (isColor(slide.bgColor)) out.push({ kind: "shape", x: 0, y: 0, w: 1920, h: 1080, shape: "rect", fill: slide.bgColor.trim() });
  for (const raw of objectsOf(slide)) {
    if (exclude.has(raw)) continue;
    const o = raw as unknown as Record<string, unknown>;
    if (o.hidden === true) continue;
    if (o.kind === "text" && o.role !== undefined) continue; // role boxes are frames, never decor
    const { id: _id, locked: _locked, ...rest } = o;
    void _id; void _locked;
    if ((rest.kind === "image" || rest.kind === "video") && !isHttpsUrl(rest.url)) continue;
    // Theme decor video is always silent (it plays on every slide using the theme).
    if (rest.kind === "video") rest.muted = true;
    if (!isValidThemeDecorObject(rest)) continue;
    out.push(rest as SlideObjectWire);
    if (out.length >= MAX_THEME_DECOR_OBJECTS) break;
  }
  return out;
}
function objectsOf(s: LayoutSlide | undefined): SlideObject[] {
  return s && Array.isArray(s.objects) ? (s.objects.filter((o) => o && typeof o === "object") as SlideObject[]) : [];
}

/**
 * The compact projector layout for a saved theme config, or undefined when the
 * theme has no saved (version 3) layout or only the untouched seed box.
 * Always passes isValidThemeLayoutWire (test-locked).
 */
export function themeLayoutFromConfig(c: Record<string, unknown>): ThemeLayoutWire | undefined {
  const raw = c.layout as { version?: unknown; slides?: unknown } | undefined;
  if (!raw || typeof raw !== "object" || raw.version !== 3 || !Array.isArray(raw.slides)) return undefined;
  const slides = raw.slides.filter((s) => s && typeof s === "object") as LayoutSlide[];
  const out: ThemeLayoutWire = {};
  const lyricSlide = slides.find((s) => s.role === "lyrics") ?? slides.find((s) => s.role !== "scripture");
  const main = mainTextOf(objectsOf(lyricSlide));
  if (main && !isUnchangedSeed(main)) {
    const f = frameFromTextObject(main);
    if (f) out.lyrics = { main: f };
  }
  // Decor is emitted even when the text box is the untouched seed (the seed box
  // alone is still never a frame).
  const lyricDecor = themeDecorFromSlide(lyricSlide, new Set([main]));
  if (lyricDecor.length) out.lyrics = { ...(out.lyrics ?? {}), decor: lyricDecor };
  const scriptureSlide = slides.find((s) => s.role === "scripture");
  if (scriptureSlide) {
    const objs = objectsOf(scriptureSlide);
    const verseObj = verseTextOf(objs);
    const verse = frameFromTextObject(verseObj);
    const refObj = objs.find((o): o is TextObject => o.kind === "text" && o.role === "reference") ?? null;
    if (verse) {
      const reference = frameFromTextObject(refObj);
      out.scripture = reference ? { verse, reference } : { verse };
    }
    const scriptureDecor = themeDecorFromSlide(scriptureSlide, new Set([verseObj, refObj]));
    if (scriptureDecor.length) out.scripture = { ...(out.scripture ?? {}), decor: scriptureDecor };
  }
  if (!out.lyrics && !out.scripture) return undefined;
  // Oversized (many large objects): drop decor from the end until it fits.
  const trim = (g: { decor?: SlideObjectWire[] } | undefined) => { if (g?.decor?.length) { g.decor.pop(); if (!g.decor.length) delete g.decor; return true; } return false; };
  while (JSON.stringify(out).length > THEME_LAYOUT_WIRE_MAX_BYTES) {
    if (!trim(out.scripture) && !trim(out.lyrics)) return undefined;
  }
  if (out.lyrics && !out.lyrics.main && !out.lyrics.decor) delete out.lyrics;
  if (out.scripture && !out.scripture.verse && !out.scripture.decor) delete out.scripture;
  if (!out.lyrics && !out.scripture) return undefined;
  return isValidThemeLayoutWire(out) ? out : undefined;
}
