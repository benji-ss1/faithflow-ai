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
  // A theme that sets a background CHOSE it, so we bake the real colour and mark
  // it `bgExplicit`. Before 2026-09-21 there was no way to say "chosen", so a pure
  // black had to be nudged to the near-black sentinel "#010101" or the projector
  // read it as unset and let the theme/template show through. Rows baked by older
  // builds still carry #010101 and still render correctly (the renderer and
  // pp7-keep-theme-bg both still recognise it) — we simply stop MINTING it.
  const bakeBgColor = cfg.bgColor;
  // Gradient themes can't bake to a single solid bgColor — the slide's own bg is
  // CLEARED (not kept) so the live gradient appearance path shows through.
  const bakeGradient = cfg.bgType === "gradient";
  // A theme that defines a background OWNS the slide's whole background stack.
  // Field bug 2026-09-19 (Victor): a slide's own non-default bgColor / bgImageUrl
  // (left by an earlier solid/image theme, or saved by the editor) outranks the
  // theme's appearance at render time (SlideRenderer: bgImageUrl > bgColor >
  // theme), so those slides stayed plain while the rest of the song restyled.
  const themeOwnsBg = !!(cfg.bgType || cfg.bgColor || cfg.bgColor2 || cfg.bgImageUrl);

  const out: Record<string, unknown> = {
    ...raw,
    bgType: bakeGradient ? raw.bgType : (cfg.bgType ?? raw.bgType),
    bgColor: bakeGradient ? raw.bgColor : (bakeBgColor ?? raw.bgColor),
    bgColor2: bakeGradient ? raw.bgColor2 : (cfg.bgColor2 ?? raw.bgColor2),
    bgImageUrl: cfg.bgImageUrl ?? raw.bgImageUrl,
    // The theme chose whatever it set, so a baked black paints instead of being
    // read as the unset DB default. Gradients bake nothing, so they keep `raw`.
    bgExplicit: bakeGradient
      ? raw.bgExplicit
      : ((cfg.bgColor ?? cfg.bgImageUrl) !== undefined ? true : raw.bgExplicit),
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
  if (themeOwnsBg) {
    // Whatever the theme does not set is dropped, so nothing older can cover it.
    out.bgType = bakeGradient ? undefined : cfg.bgType;
    out.bgColor = bakeGradient ? undefined : bakeBgColor;
    out.bgColor2 = bakeGradient ? undefined : cfg.bgColor2;
    out.bgImageUrl = cfg.bgImageUrl;
    out.bgExplicit = (out.bgColor ?? out.bgImageUrl) !== undefined ? true : undefined;
    for (const k of ["bgType", "bgColor", "bgColor2", "bgImageUrl", "bgExplicit"]) if (out[k] === undefined) delete out[k];
  }
  return out;
}
