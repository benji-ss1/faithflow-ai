/**
 * The pages that draw the CONGREGATION-FACING output: the projector (/live), the stage
 * confidence monitor (/stage), the livestream overlay (/livestream) and the NDI feed
 * (/ndi). Nothing meant for the operator — update prompts, offline banners, toasts —
 * may ever appear on them (2026-09-19: "New version available — Reload now" showed on
 * the live projector because it was mounted in the root layout).
 */
export const OUTPUT_SURFACE_PATHS = ["/live", "/stage", "/livestream", "/ndi"] as const;

/** True for an output page (and anything beneath it). `/live` must not match `/livestream`. */
export function isOutputSurfacePath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const p = pathname.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
  return OUTPUT_SURFACE_PATHS.some((s) => p === s || p.startsWith(`${s}/`));
}
