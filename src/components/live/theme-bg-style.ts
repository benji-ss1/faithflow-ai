import type { CSSProperties } from "react";
import type { ThemeAppearance } from "@/lib/broadcast";

// ── Themes Phase 1: compute CSS from the active theme appearance ───────────
// Background supports solid / gradient / image, with an optional dark "dim"
// overlay for text readability (a single `background` shorthand — image/gradient
// layered under a dim gradient). Returns the built-in fallback when no theme is
// active. The values are validated on the wire (isValidThemeAppearance), and a
// hostile string can't break out of the single `background`/`color` CSS property
// (CSSOM parses each property in isolation).
export function themeBackgroundStyle(
  appearance: ThemeAppearance | null | undefined,
  fallback: string,
  /** 2026-09-20 owner directive: when nothing was actually CHOSEN as a background, the
   *  slide is a transparent text layer and whatever sits underneath (media, camera,
   *  background template) shows through. The opaque black lives on the surface, not on
   *  the slide. Off ⇒ the previous opaque `fallback`, byte-identical. */
  transparentDefault?: boolean,
): CSSProperties {
  const none = transparentDefault ? { background: "transparent" } : { background: fallback };
  if (!appearance) return none;
  const dim = typeof appearance.dim === "number" && appearance.dim > 0 ? Math.min(1, appearance.dim) : 0;
  const dimLayer = dim > 0 ? `linear-gradient(rgba(0,0,0,${dim}),rgba(0,0,0,${dim}))` : null;
  let base: string | undefined;
  if (appearance.bgType === "image" && appearance.bgImageUrl) {
    base = `url("${appearance.bgImageUrl}")`;
  } else if (appearance.bgType === "gradient" && appearance.bgColor) {
    base = `linear-gradient(${appearance.bgAngle ?? 180}deg, ${appearance.bgColor}, ${appearance.bgColor2 ?? appearance.bgColor})`;
  } else if (appearance.bgColor) {
    base = appearance.bgColor;
  }
  if (!base) return none;
  return {
    background: dimLayer ? `${dimLayer}, ${base}` : base,
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  };
}
