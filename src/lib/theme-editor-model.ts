// Theme Editor (PR 1) — pure model helpers shared by the editor modal and tests.
// Converts a theme's config ⇄ the slide editor's rows, and derives the flat
// (legacy) theme fields from the layout so existing consumers (bake, appearance,
// old ThemesManager) keep reading the same keys.
import { CANVAS_W, type EditableSlide, type SlideObject, type TextObject } from "./slide-objects";

export type ThemeSlideRole = "lyrics" | "scripture";
export type ThemeSlideMeta = { name: string; role?: ThemeSlideRole };
export type ThemeEditorRow = { id: string; lyrics: string; objectsJson: unknown };

type Cfg = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** The text box that carries the theme's main (lyrics/text) style on a slide. */
export function mainTextOf(objects: SlideObject[]): TextObject | null {
  const texts = objects.filter((o): o is TextObject => o.kind === "text");
  const tagged = texts.find((t) => t.role === "main");
  if (tagged) return tagged;
  if (texts.some((t) => t.role)) return null; // roles in use but no main box
  return texts[0] ?? null;
}

/** The verse (scripture body) text box on a slide, if one is tagged. */
export function verseTextOf(objects: SlideObject[]): TextObject | null {
  return objects.find((o): o is TextObject => o.kind === "text" && o.role === "verse") ?? null;
}

/**
 * The ONE text box the Theme tab's Typography controls read from and write to
 * for a slide: the verse box on a scripture slide, the main box otherwise.
 * There is no separate typography state that could drift from the boxes.
 */
export function typographyTargetOf(objects: SlideObject[], role: ThemeSlideRole | undefined): TextObject | null {
  return role === "scripture" ? (verseTextOf(objects) ?? mainTextOf(objects)) : mainTextOf(objects);
}

/** Clamp a typed font size; null for empty/NaN/out-of-range input. */
export function parseThemeFontSize(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 12 || n > 400) return null;
  return Math.round(n);
}

/** The seed slide for a theme with no saved layout: a centred main text box
 *  styled from the theme's existing flat fields. */
export function seedThemeSlide(cfg: Cfg): { row: ThemeEditorRow; meta: ThemeSlideMeta } {
  const h = 400;
  const text: TextObject = {
    id: "theme_main_text",
    kind: "text",
    x: 80, y: Math.round((1080 - h) / 2), w: CANVAS_W - 160, h,
    text: "Lyrics appear here",
    fontFamily: str(cfg.fontFamily) ?? "Inter",
    fontSize: num(cfg.fontSizePx) ?? 72,
    fontWeight: num(cfg.fontWeight) ?? 600,
    color: str(cfg.textColor) ?? "#ffffff",
    align: cfg.align === "left" || cfg.align === "right" ? cfg.align : "center",
    shadow: typeof cfg.textShadow === "boolean" ? cfg.textShadow : undefined,
    role: "main",
  };
  // No per-slide background: the theme background (Theme tab) paints behind it.
  return {
    row: { id: "theme_slide_lyrics", lyrics: "", objectsJson: { objects: [text] } },
    meta: { name: "Lyrics", role: "lyrics" },
  };
}

/** Theme config → slide editor rows (+ per-slide name/role metadata). */
export function themeLayoutToRows(cfg: Cfg): { rows: ThemeEditorRow[]; meta: Record<string, ThemeSlideMeta> } {
  const layout = cfg.layout as { version?: unknown; slides?: unknown } | undefined;
  const slides = layout && layout.version === 3 && Array.isArray(layout.slides) ? (layout.slides as Cfg[]) : [];
  const rows: ThemeEditorRow[] = [];
  const meta: Record<string, ThemeSlideMeta> = {};
  for (const s of slides) {
    if (typeof s.id !== "string" || meta[s.id]) continue;
    const objects = Array.isArray(s.objects) ? s.objects : [];
    // An empty slide must still hydrate as empty (not the legacy lyric fallback).
    rows.push({ id: s.id, lyrics: "", objectsJson: { bgColor: s.bgColor, bgImageUrl: s.bgImageUrl, objects } });
    meta[s.id] = { name: typeof s.name === "string" ? s.name : "Slide", role: s.role === "scripture" ? "scripture" : s.role === "lyrics" ? "lyrics" : undefined };
  }
  if (rows.length === 0) {
    const seed = seedThemeSlide(cfg);
    rows.push(seed.row);
    meta[seed.row.id] = seed.meta;
  }
  return { rows, meta };
}

/** Editor state → the config to save: layout + flat fields derived from the
 *  lyrics slide's main text box. Everything else in `cfg` is kept. */
export function buildThemeSaveConfig(cfg: Cfg, slides: EditableSlide[], meta: Record<string, ThemeSlideMeta>): Cfg {
  const layoutSlides = slides.map((s, i) => {
    const m = meta[s.id];
    const out: Cfg = {
      id: s.id,
      name: m?.name?.trim() || `Slide ${i + 1}`,
      objects: s.objects,
    };
    if (m?.role) out.role = m.role;
    if (s.bgColor) out.bgColor = s.bgColor;
    if (s.bgImageUrl) out.bgImageUrl = s.bgImageUrl;
    return out;
  });
  const next: Cfg = { ...cfg, layout: { version: 3, slides: layoutSlides } };
  const lyricSlide = slides.find((s) => meta[s.id]?.role === "lyrics") ?? slides[0];
  const main = lyricSlide ? mainTextOf(lyricSlide.objects) : null;
  if (main) {
    if (main.fontFamily) next.fontFamily = main.fontFamily;
    if (typeof main.fontSize === "number") next.fontSizePx = main.fontSize;
    if (typeof main.fontWeight === "number") next.fontWeight = main.fontWeight;
    if (main.color) next.textColor = main.color;
    if (main.align) next.align = main.align;
    if (typeof main.shadow === "boolean") next.textShadow = main.shadow;
  }
  // Scripture size comes from the verse box (a scripture slide's first, else any).
  const scriptureSlides = slides.filter((s) => meta[s.id]?.role === "scripture");
  const verse = [...scriptureSlides, ...slides].map((s) => verseTextOf(s.objects)).find((v) => v) ?? null;
  if (verse && typeof verse.fontSize === "number") next.fontSizeScripturePx = verse.fontSize;
  return next;
}
