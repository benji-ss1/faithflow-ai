// Scripture design model + sanitizers — PURE and SERVER-SAFE (no window, no
// "use client" imports). Moved out of components/operator/scripture/scriptureStyle.ts
// (which re-exports everything here, so existing imports are unchanged) so the
// per-church style server actions validate with exactly the same rules the
// client has always applied to a saved style.
import { CANVAS_W, CANVAS_H } from "./slide-objects";
import { BAND_DEFAULT_COLOR } from "./band-media";
import { isValidColor, FONT_FAMILY_RE } from "./broadcast";

export type TextStyle = {
  x: number; y: number; w: number; h: number;
  fontFamily: string; fontSize: number; fontWeight: number;
  color: string; align: "left" | "center" | "right";
  italic: boolean; uppercase: boolean; shadow: boolean;
  stroke: string; strokeWidth: number; lineHeight: number; letterSpacing: number;
};

// Scripture projection layout. "fullscreen" = the classic full-canvas verse
// (styled per-object, drag-editable). "lowerThird" = a big verse confined to a
// band (optionally coloured) so it can be composited over the church's content.
export type ScriptureLayout = "fullscreen" | "lowerThird";

// Which third of the screen the band sits in.
export type ThirdPosition = "upper" | "mid" | "lower";

// The scripture band. mode "none" = transparent; "solid" = flat colour;
// "gradient" = colour → color2. Default is a BLACK solid band.
export type BandStyle = {
  mode: "none" | "solid" | "gradient";
  color: string;
  color2: string;
  angle: number;   // gradient angle in degrees
  opacity: number; // 0..1
  position: ThirdPosition;
  offsetY: number;   // fine vertical nudge, % of screen height (−25..25); + = down
  heightPct: number; // band height, % of screen height
  fontScale: number; // verse size multiplier
  refScale: number;  // reference-line size multiplier (1 = today's size)
  widthPct: number;  // width of the verse + reference text area, % of screen width (88 = today)
};

export type ScriptureDesign = {
  layout: ScriptureLayout;
  verse: TextStyle;
  reference: TextStyle & { show: boolean; showTranslation: boolean };
  band: BandStyle;
};

export const clampNum = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

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

// Soft charcoal band by default (BAND_DEFAULT_COLOR, PR #56) — legible over ANY content the church runs underneath.
export const BAND_DEFAULT: BandStyle = {
  mode: "solid", color: BAND_DEFAULT_COLOR, color2: BAND_DEFAULT_COLOR, angle: 180, opacity: 0.72,
  position: "lower", offsetY: 0, heightPct: 30, fontScale: 1, refScale: 1, widthPct: 88,
};

export const DEFAULT_SCRIPTURE_DESIGN: ScriptureDesign = {
  layout: "fullscreen",
  verse: { ...VERSE_DEFAULT },
  reference: { ...REF_DEFAULT },
  band: { ...BAND_DEFAULT },
};

/** Max serialized size of a stored Scripture Style (server-enforced). */
export const SCRIPTURE_DESIGN_MAX_BYTES = 16 * 1024;

// A corrupted / hand-edited saved band (e.g. heightPct:500, fontScale:NaN,
// opacity:9, color:"red") would otherwise produce an INVALID wire band on EVERY
// slide → receivers drop the band/media. Clamp every field to the editor's
// ranges; bad values fall back to BAND_DEFAULT. (Ranges unchanged from the
// original client sanitizer — property-tested.)
export function sanitizeBandStyle(raw: unknown): BandStyle {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const D = BAND_DEFAULT;
  const num = (v: unknown, lo: number, hi: number, def: number) =>
    typeof v === "number" && Number.isFinite(v) ? clampNum(v, lo, hi) : def;
  const hex = (v: unknown, def: string) =>
    typeof v === "string" && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v) ? v : def;
  return {
    mode: b.mode === "none" || b.mode === "solid" || b.mode === "gradient" ? b.mode : D.mode,
    color: hex(b.color, D.color),
    color2: hex(b.color2, D.color2),
    angle: num(b.angle, 0, 360, D.angle),
    opacity: num(b.opacity, 0, 1, D.opacity),
    position: b.position === "upper" || b.position === "mid" || b.position === "lower" ? b.position : D.position,
    offsetY: num(b.offsetY, -25, 25, D.offsetY),
    heightPct: num(b.heightPct, 10, 60, D.heightPct),
    // 2026-09-19: lower bound 0.5 -> 0.3 so the verse can be dialled down to the
    // reference line's size (owner request); the wire validator already allows 0.1..4.
    fontScale: num(b.fontScale, 0.3, 2, D.fontScale),
    refScale: num(b.refScale, 0.5, 3, D.refScale),
    widthPct: num(b.widthPct, 50, 100, D.widthPct),
  };
}

// Merge a stored text style over its default. Same semantics as the original
// `{ ...DEFAULT, ...parsed }` spread for well-typed values; additionally drops
// unknown keys and wrongly-typed values (so server-stored JSON can't smuggle
// arbitrary fields/strings-as-numbers onto every scripture slide).
function mergeTextStyle<T extends TextStyle>(def: T, raw: unknown): T {
  const out = { ...def } as Record<string, unknown>;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out as T;
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(def)) {
    if (!(k in r)) continue;
    const v = r[k];
    const d = (def as Record<string, unknown>)[k];
    if (k === "align") { if (v === "left" || v === "center" || v === "right") out[k] = v; continue; }
    if (typeof d === "number") { if (typeof v === "number" && Number.isFinite(v)) out[k] = v; continue; }
    // stroke → same colour rule the output sanitizer enforces; fontFamily → the
    // safe CSS charset (it is interpolated into a CSS value on every output).
    if (k === "stroke") { if (isValidColor(v)) out[k] = v; continue; }
    if (k === "fontFamily") { if (typeof v === "string" && FONT_FAMILY_RE.test(v)) out[k] = v; continue; }
    if (typeof d === "string") { if (typeof v === "string" && v.length <= 200) out[k] = v; continue; }
    if (typeof d === "boolean") { if (typeof v === "boolean") out[k] = v; continue; }
  }
  return out as T;
}

/**
 * Sanitize an untrusted Scripture Style (localStorage, server JSON, client
 * action input). Returns null when it isn't an object at all. Back-compat:
 * pre-lower-third styles have no layout/band → fullscreen + the black band.
 */
export function sanitizeScriptureDesign(raw: unknown): ScriptureDesign | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const p = raw as Partial<Record<keyof ScriptureDesign, unknown>>;
  return {
    layout: p.layout === "lowerThird" ? "lowerThird" : "fullscreen",
    verse: mergeTextStyle(DEFAULT_SCRIPTURE_DESIGN.verse, p.verse),
    reference: mergeTextStyle(DEFAULT_SCRIPTURE_DESIGN.reference, p.reference),
    band: sanitizeBandStyle(p.band),
  };
}

// ---- Per-content-type default themes (pure) --------------------------------

export type ContentStyleType = "song" | "scripture";
export type ContentTypeStyles = Partial<Record<ContentStyleType, string>>; // type → themeId

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Keep only song|scripture → uuid entries. Non-object → {}. */
export function sanitizeContentTypeStyles(raw: unknown): ContentTypeStyles {
  const out: ContentTypeStyles = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const r = raw as Record<string, unknown>;
  for (const k of ["song", "scripture"] as const) {
    const v = r[k];
    if (typeof v === "string" && UUID_RE.test(v)) out[k] = v;
  }
  return out;
}
