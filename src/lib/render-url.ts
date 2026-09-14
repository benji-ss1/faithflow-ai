// Shared, dependency-free validator for a droppable / rendered media URL.
//
// Used both at WRITE time (actions.ts: setServiceItemSlideBackground,
// addServiceItemImageSlide, setSongSlideBackgroundImage, createSongImageSlide)
// AND at READ time (server/services.ts: re-validating stored `slideBackgrounds` /
// `extraImageSlides` / song-slide `objectsJson.bgImageUrl` before they reach the
// projector, and sanitizeThemeConfig value-validating logoUrl/bgImageUrl/bgVideoUrl).
// Re-checking on read means a URL that slipped in via a legacy row or a
// direct-DB write can never render an off-scheme / oversized value into an
// output channel.
//
// Accepted shapes (the URLs the app really produces):
//   • same-origin absolute paths  — "/api/media/…", "/marketing/x.jpg"
//   • http(s) URLs                — presigned S3/MinIO/Supabase storage URLs
//   • blob: URLs                  — local in-editor previews
//   • data:image/(png|jpeg|jpg|gif|webp) — uploaded/cropped images from editors
// Rejected (2026-09-14 security pass): protocol-relative "//host" (loads an
// arbitrary host), any backslash (browsers normalise "\" to "/" → "/\host"),
// quotes / whitespace / angle brackets (CSS url() / attribute breakout), and any
// data: that isn't one of the raster image types above (svg+xml can carry script).
//
// Pure: no DB, no React, no server-only deps. Directly unit-testable.
export function cleanRenderUrl(url: unknown): string | null {
  const clean = typeof url === "string" ? url.trim() : "";
  if (!clean || clean.length > 2048) return null;
  if (/["'\s<>\\]/.test(clean)) return null;
  if (clean.startsWith("//")) return null;
  if (/^data:/i.test(clean)) {
    return /^data:image\/(png|jpe?g|gif|webp)[;,]/i.test(clean) ? clean : null;
  }
  if (!/^(https?:\/\/|blob:|\/)/i.test(clean)) return null;
  return clean;
}
