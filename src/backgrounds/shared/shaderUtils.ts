// Shared helpers + the readable-floor constants used by every surface that
// renders a Background Template shader (the live projector via ShaderBackground,
// and the operator preview cards via SharedBackgroundRenderer + ThemedSlideCard).
//
// The FLOOR is load-bearing: it's the opaque dark backstop that guarantees an
// un-initialised or context-lost `alpha:false` WebGL canvas can never composite
// to WHITE on the projector. Live and card copies MUST be identical or the
// "preview is a 1:1 replica of live" guarantee silently drifts — hence one place.

/** Opaque dark base painted UNDER a shader canvas (never white). */
export const FLOOR_GRADIENT = "linear-gradient(160deg, #0A0A0E, #0F0F14)";

/** A theme-colour tint laid over the floor at low opacity so a blank canvas still
 *  reads as the theme colour (warm/cool) instead of flat black. */
export const FLOOR_TINT_OPACITY = 0.35;
export function tintGradient(primary: string, secondary: string): string {
  return `linear-gradient(135deg, ${primary}, ${secondary})`;
}

/** Default shader colour fallbacks (0..1 rgb) for missing/invalid theme colours. */
export const PRIMARY_RGB_FALLBACK: [number, number, number] = [0.04, 0.04, 0.05];
export const SECONDARY_RGB_FALLBACK: [number, number, number] = [0.06, 0.06, 0.08];

export function hexToRgb(hex: string, fallback: [number, number, number]): [number, number, number] {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return fallback;
  const n = parseInt(h, 16);
  if (!Number.isFinite(n)) return fallback;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function prefersReducedMotion(): boolean {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}
