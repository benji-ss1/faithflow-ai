// Shared, dependency-free validator for a droppable / rendered media URL.
//
// Used both at WRITE time (actions.ts: setServiceItemSlideBackground,
// addServiceItemImageSlide, the song image-slide paths) AND at READ time
// (server/services.ts: re-validating stored `slideBackgrounds` /
// `extraImageSlides` before they reach the projector, and sanitizeThemeConfig
// value-validating logoUrl/bgImageUrl/bgVideoUrl). Re-checking on read means a
// URL that slipped in via a legacy row or a direct-DB write can never render an
// off-scheme / oversized value into an output channel.
//
// Pure: no DB, no React, no server-only deps. Directly unit-testable.
export function cleanRenderUrl(url: unknown): string | null {
  const clean = typeof url === "string" ? url.trim() : "";
  if (!clean || clean.length > 2048 || !/^(https?:|blob:|data:image\/|\/)/i.test(clean)) return null;
  return clean;
}
