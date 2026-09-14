// ONE URL POLICY (2026-09-14 release gate) — the single, dependency-free
// validator for any media URL that is SAVED, READ back, or RENDERED on an output.
//
// Used at WRITE time (actions.ts: slide backgrounds, image slides, song-slide
// objects), at READ time (server/services.ts re-validates stored values) AND at
// OUTPUT time (broadcast.ts isValidRenderUrl / isValidMediaUrl / sanitizeSlide,
// theme-appearance.ts). Previously those layers disagreed: output accepted
// http:// on ANY host and unescaped quotes/whitespace on media slides, while the
// save/read layer accepted same-origin relative "/api/media/…" paths that the
// output validators (new URL() on a relative string throws) then silently
// dropped — so a saved relative background vanished on /live /stage /livestream
// /ndi. Projector pages are same-origin with the app, so a relative path resolves.
//
// Accepted:
//   • same-origin paths under an explicit prefix allowlist ONLY — "/api/media/<id>",
//     "/marketing/x.jpg", "/brand/…", "/login/…" (see MEDIA_PATH / STATIC_PREFIXES)
//   • https:// URLs (presigned S3 / Supabase storage)
//   • http:// ONLY for localhost / 127.0.0.1 / [::1] AND only outside production
//     (dev MinIO). Statically false in prod builds.
//   • blob: URLs (local in-editor previews)
//   • data:image/(png|jpeg|jpg|gif|webp) (raster only — svg+xml can carry script)
// Rejected: protocol-relative "//host", any backslash, quotes / whitespace /
// angle brackets / control chars (CSS url() / attribute breakout), and anything
// else (javascript:, file:, ftp:, "https:evil.com" without "//", non-raster data:).
//
// Pure: no DB, no React, no server-only deps. Directly unit-testable.
const ALLOW_HTTP_LOOPBACK = process.env.NODE_ENV !== "production";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /["'\s<>\\\u0000-\u001f\u007f]/;

// RELATIVE-PATH ALLOWLIST (2026-09-14 security gate). Output pages are same-origin
// and credentialed, so an arbitrary relative path (e.g.
// "/api/auth/device-exchange?token=…") loaded as a background would make the
// projector perform an authenticated GET against an app route. Only the prefixes
// that real producers emit are allowed: stored media ("/api/media/<id>") and the
// static public/ image folders (marketing, brand, login). No query/fragment (no
// producer needs one), no dot segments, no percent-encoded dot/slash/backslash.
// Stored media: exactly "/api/media/<uuid>" with an optional single file-name
// segment — never an app route under that prefix ("/api/media/list", "/presign").
const MEDIA_PATH = /^\/api\/media\/[0-9a-fA-F-]{36}(\/[\w.-]+)?$/;
// Static public/ folders: image / video files only (no svg — it can carry script).
const STATIC_PREFIXES = ["/marketing/", "/brand/", "/login/"];
const STATIC_EXT = /\.(png|jpe?g|gif|webp|mp4|webm|mov)$/i;
function isAllowedRelativePath(p: string): boolean {
  if (/[?#%]/.test(p)) return false;
  if (p.split("/").some((seg) => seg === "." || seg === "..")) return false;
  if (MEDIA_PATH.test(p)) return true;
  return STATIC_PREFIXES.some((pre) => p.startsWith(pre) && p.length > pre.length) && STATIC_EXT.test(p);
}

export function cleanRenderUrl(url: unknown): string | null {
  const clean = typeof url === "string" ? url.trim() : "";
  if (!clean || clean.length > 2048) return null;
  if (UNSAFE_CHARS.test(clean)) return null;
  if (clean.startsWith("//")) return null;
  if (clean.startsWith("/")) return isAllowedRelativePath(clean) ? clean : null;
  if (/^data:/i.test(clean)) {
    return /^data:image\/(png|jpe?g|gif|webp)[;,]/i.test(clean) ? clean : null;
  }
  if (/^blob:/i.test(clean)) return clean;
  if (/^https:\/\//i.test(clean)) {
    try { return new URL(clean).protocol === "https:" ? clean : null; } catch { return null; }
  }
  if (ALLOW_HTTP_LOOPBACK && /^http:\/\//i.test(clean)) {
    try {
      const p = new URL(clean);
      return p.protocol === "http:" && LOOPBACK_HOSTS.has(p.hostname) ? clean : null;
    } catch { return null; }
  }
  return null;
}

/** Output-side predicate: the value must ALREADY be clean (no trimming on the
 *  wire — a padded value is rejected rather than silently rewritten).
 *  `allowBlob:false` is the ONE deliberate output narrowing (unchanged from the
 *  pre-unification behaviour): slide-object / background / theme URLs never
 *  carried blob: on the wire — a blob: is a tab-local in-editor preview, and a
 *  stale one in a snapshot must be dropped by the sanitizer, not rendered as a
 *  broken image. Media slides keep accepting blob: as they always did. */
export function isRenderableUrl(u: unknown, opts?: { allowBlob?: boolean }): u is string {
  if (typeof u !== "string" || cleanRenderUrl(u) !== u) return false;
  if (opts?.allowBlob === false && /^blob:/i.test(u)) return false;
  return true;
}
