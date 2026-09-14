// Pure theme-baking helper — mirrors the per-slide bake inside
// actions.ts:applyThemeToSong EXACTLY, extracted so the new per-slide
// "apply theme to THIS slide" action (and its tests) can reuse it without
// touching the proven whole-song path. Bakes a theme's config into ONE slide's
// objectsJson so the look lives IN the slide → preview and live render it
// identically (the WYSIWYG mandate), with the same contrast/gradient/black-bg
// guards the whole-song bake uses.
import { readableTextColor } from "./colorway";

export type BakeableThemeConfig = {
  fontFamily?: string;
  fontSizePx?: number;
  fontWeight?: number;
  textColor?: string;
  align?: "left" | "center" | "right";
  bgType?: "solid" | "gradient" | "image" | "video";
  bgColor?: string;
  bgColor2?: string;
  bgImageUrl?: string;
  transition?: unknown;
};

// Expand 3-digit hex (#fff → #ffffff) so readableTextColor (6-hex only) judges tone.
function to6Hex(c: string): string {
  const m = /^#?([0-9a-fA-F]{3})$/.exec(c.trim());
  return m ? "#" + m[1]!.split("").map((ch) => ch + ch).join("") : c.trim();
}
const isHex6 = (c: string) => /^#[0-9a-fA-F]{6}$/.test(c);

export function bakeThemeIntoObjectsJson(cfg: BakeableThemeConfig, rawObjectsJson: unknown): Record<string, unknown> {
  const raw = (rawObjectsJson as Record<string, unknown> | null) ?? {};
  const objects = Array.isArray(raw.objects) ? (raw.objects as Record<string, unknown>[]) : [];

  const bakeBg = typeof cfg.bgColor === "string" ? cfg.bgColor : undefined;
  // Auto-contrast: don't bake a text colour that would be unreadable on the bg.
  const bakeTextColor = (themeText: unknown, objColor: unknown): unknown => {
    if (typeof bakeBg !== "string") return themeText ?? objColor;
    const bg6 = to6Hex(bakeBg);
    if (typeof themeText !== "string") return isHex6(bg6) ? readableTextColor(bg6) : (objColor ?? "#ffffff");
    const text6 = to6Hex(themeText);
    if (!isHex6(bg6) || !isHex6(text6)) return themeText;
    const bgLight = readableTextColor(bg6) === "#111111";
    const textLight = readableTextColor(text6) === "#111111";
    return bgLight === textLight ? readableTextColor(bg6) : themeText;
  };
  // A pure-black baked bg is read as "unset" by the projector — nudge to near-black.
  const isBlackBg = typeof cfg.bgColor === "string" && ["#000000", "#000", "black", "rgb(0,0,0)"].includes(cfg.bgColor.trim().toLowerCase());
  const bakeBgColor = isBlackBg ? "#010101" : cfg.bgColor;
  // Gradient themes can't bake to a single solid bgColor — leave the slide's bg so
  // the live gradient appearance path shows through.
  const bakeGradient = cfg.bgType === "gradient";

  return {
    ...raw,
    bgType: bakeGradient ? raw.bgType : (cfg.bgType ?? raw.bgType),
    bgColor: bakeGradient ? raw.bgColor : (bakeBgColor ?? raw.bgColor),
    bgColor2: bakeGradient ? raw.bgColor2 : (cfg.bgColor2 ?? raw.bgColor2),
    bgImageUrl: cfg.bgImageUrl ?? raw.bgImageUrl,
    transition: cfg.transition ?? raw.transition,
    objects: objects.map((o) => {
      if (o?.kind !== "text") return o;
      return {
        ...o,
        fontFamily: cfg.fontFamily ?? o.fontFamily,
        fontSize: cfg.fontSizePx ?? o.fontSize,
        fontWeight: cfg.fontWeight ?? o.fontWeight,
        color: bakeTextColor(cfg.textColor, o.color),
        align: cfg.align ?? o.align,
      };
    }),
  };
}
