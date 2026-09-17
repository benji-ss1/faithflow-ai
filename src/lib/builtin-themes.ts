// Built-in themes (ProPresenter-style starter looks). PURE constants — no DB,
// no media URLs — so they're safe to ship in the client bundle AND to look up
// server-side by id (materializeBuiltinTheme never trusts a client config).
//
// A built-in is never applied directly: it is MATERIALIZED into a per-church
// themes row (config.builtinId = its id, dedupe key) so every existing
// theme path (applyThemeLive, song bake, re-apply, section themes) keeps
// working on a real DB theme.
import type { ThemeConfig } from "./theme-config";
import type { ThemeLayout } from "./theme-layout";

export const BUILTIN_THEME_PREFIX = "builtin:";

export type BuiltinTheme = { id: string; name: string; config: ThemeConfig };

type Look = {
  font: string;
  bodyFont?: string;
  size: number;
  scriptureSize: number;
  weight: number;
  text: string;
  align?: "left" | "center" | "right";
  shadow?: boolean;
  bgType: "solid" | "gradient";
  bg: string;
  bg2?: string;
  angle?: number;
  refColor?: string;
};

function layoutFor(l: Look): ThemeLayout {
  const align = l.align ?? "center";
  return {
    version: 3,
    slides: [
      {
        id: "theme_slide_lyrics",
        name: "Lyrics",
        role: "lyrics",
        objects: [{
          id: "theme_main_text", kind: "text", x: 80, y: 340, w: 1760, h: 400,
          text: "Lyrics appear here", fontFamily: l.font, fontSize: l.size, fontWeight: l.weight,
          color: l.text, align, ...(l.shadow !== undefined ? { shadow: l.shadow } : {}), role: "main",
        }],
      },
      {
        id: "theme_slide_scripture",
        name: "Scripture",
        role: "scripture",
        objects: [
          {
            id: "theme_verse_text", kind: "text", x: 120, y: 240, w: 1680, h: 520,
            text: "For God so loved the world…", fontFamily: l.bodyFont ?? l.font, fontSize: l.scriptureSize,
            fontWeight: Math.min(l.weight, 600), color: l.text, align, role: "verse",
          },
          {
            id: "theme_reference_text", kind: "text", x: 120, y: 800, w: 1680, h: 100,
            text: "John 3:16", fontFamily: l.font, fontSize: Math.round(l.scriptureSize * 0.7),
            fontWeight: 600, color: l.refColor ?? l.text, align, role: "reference",
          },
        ],
      },
    ],
  };
}

function make(slug: string, name: string, l: Look): BuiltinTheme {
  const config: ThemeConfig = {
    fontFamily: l.font,
    ...(l.bodyFont ? { fontBodyFamily: l.bodyFont } : {}),
    fontSizePx: l.size,
    fontSizeScripturePx: l.scriptureSize,
    fontWeight: l.weight,
    textColor: l.text,
    align: l.align ?? "center",
    textShadow: l.shadow ?? false,
    bgType: l.bgType,
    bgColor: l.bg,
    ...(l.bg2 ? { bgColor2: l.bg2 } : {}),
    ...(l.angle !== undefined ? { bgAngle: l.angle } : {}),
    scriptureShowReference: true,
    scriptureReferencePosition: "below",
    scriptureTranslationVisible: true,
    transitionType: "fade",
    transitionDurationMs: 400,
    layout: layoutFor(l),
    builtinId: BUILTIN_THEME_PREFIX + slug,
  };
  return { id: BUILTIN_THEME_PREFIX + slug, name, config };
}

export const BUILTIN_THEMES: readonly BuiltinTheme[] = Object.freeze([
  make("default", "Default", { font: "Inter", size: 72, scriptureSize: 60, weight: 600, text: "#ffffff", shadow: true, bgType: "solid", bg: "#000000" }),
  make("classic", "Classic", { font: "Georgia", size: 70, scriptureSize: 58, weight: 500, text: "#f5efe0", shadow: true, bgType: "gradient", bg: "#1b1f3a", bg2: "#0a0c1a", angle: 180, refColor: "#d9c38c" }),
  make("modern", "Modern", { font: "Montserrat", bodyFont: "Inter", size: 76, scriptureSize: 58, weight: 700, text: "#ffffff", bgType: "gradient", bg: "#2b1055", bg2: "#7597de", angle: 135 }),
  make("minimal", "Minimal", { font: "Helvetica", size: 64, scriptureSize: 54, weight: 400, text: "#e8e8e8", bgType: "solid", bg: "#111111" }),
  make("church", "Church", { font: "Playfair Display", bodyFont: "Spectral", size: 72, scriptureSize: 58, weight: 600, text: "#fff8e7", shadow: true, bgType: "gradient", bg: "#3b1d0e", bg2: "#12070a", angle: 160, refColor: "#e6c27a" }),
  make("dark", "Dark", { font: "Sora", size: 72, scriptureSize: 58, weight: 600, text: "#f2f2f2", bgType: "gradient", bg: "#0d0d12", bg2: "#1c1c26", angle: 180 }),
  make("light", "Light", { font: "Plus Jakarta Sans", size: 70, scriptureSize: 56, weight: 600, text: "#111827", bgType: "solid", bg: "#f8f7f2", refColor: "#374151" }),
]);

const BY_ID = new Map(BUILTIN_THEMES.map((t) => [t.id, t]));

export function isBuiltinThemeId(v: unknown): v is string {
  return typeof v === "string" && BY_ID.has(v);
}

export function getBuiltinTheme(id: unknown): BuiltinTheme | null {
  return typeof id === "string" ? BY_ID.get(id) ?? null : null;
}

/** A fresh deep copy of a built-in's config (callers may mutate it). */
export function builtinThemeConfig(id: unknown): ThemeConfig | null {
  const t = getBuiltinTheme(id);
  return t ? (JSON.parse(JSON.stringify(t.config)) as ThemeConfig) : null;
}
