// Themes 4 — build a projection-friendly colourway from a logo's dominant
// colours, with smart contrast. Pure functions, no deps; usable client-side.

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec((hex || "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("");
}

function luminance([r, g, b]: [number, number, number]): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function saturation([r, g, b]: [number, number, number]): number {
  const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255;
  if (mx === mn) return 0;
  const l = (mx + mn) / 2;
  return l > 0.5 ? (mx - mn) / (2 - mx - mn) : (mx - mn) / (mx + mn);
}

function darken([r, g, b]: [number, number, number], f: number): [number, number, number] {
  return [r * (1 - f), g * (1 - f), b * (1 - f)];
}

/** Smart contrast: black text on light backgrounds, white on dark. */
export function readableTextColor(bg: string): string {
  const rgb = hexToRgb(bg);
  if (!rgb) return "#ffffff";
  return luminance(rgb) > 0.6 ? "#111111" : "#ffffff";
}

/**
 * Turn a logo palette into a theme colourway: the most vibrant colour becomes
 * the brand hue, rendered as a rich dark gradient behind auto-contrasted text —
 * a safe, readable projection look that clearly echoes the church's logo.
 */
export function buildColorwayFromPalette(colors: string[]): {
  bgType: "gradient";
  bgColor: string;
  bgColor2: string;
  textColor: string;
} | null {
  const rgbs = colors.map(hexToRgb).filter((c): c is [number, number, number] => c !== null);
  if (rgbs.length === 0) return null;
  const brand = [...rgbs].sort((a, b) => saturation(b) - saturation(a))[0];
  const bg = rgbToHex(...darken(brand, 0.80));
  const bg2 = rgbToHex(...darken(brand, 0.62));
  return { bgType: "gradient", bgColor: bg, bgColor2: bg2, textColor: readableTextColor(bg) };
}
