import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { apiUser } from "@/lib/session";
import { createLimiter } from "@/lib/rate-limit";
import { presignPut } from "@/lib/s3";

// Modern raster + universally-supported types. SVG is DELIBERATELY EXCLUDED
// — an SVG can carry inline <script> tags and would be an XSS vector unless
// sanitized server-side (would need DOMPurify against the SVG namespace,
// not currently plumbed). If we want to add SVG later, do it in its own
// commit with a proper sanitize step. HEIC needs libheif conversion to
// WebP which requires sharp+libheif in the Vercel runtime — separate lift.
const ALLOWED_IMAGE = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
];
const ALLOWED_VIDEO = ["video/mp4", "video/webm", "video/quicktime"];
const ALLOWED_PPTX = [
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  "application/vnd.ms-powerpoint",                                             // legacy .ppt
];

// Purpose-aware size caps so a caller can't shove a 500MB "logo" through the
// same endpoint that legitimately serves 500MB service-media video uploads.
// Client-side gates (ChurchBrandingUploader = 2MB) are advisory; the server
// is authoritative here.
const MAX_BYTES: Record<string, number> = {
  logo: 2 * 1024 * 1024,          //  2MB — favicon-shaped brand mark
  media: 500 * 1024 * 1024,       // 500MB — service backgrounds, videos, stills
  // 150MB — matches the Fly converter's MAX_SOURCE_BYTES so an oversized deck
  // is rejected UP FRONT (fast, clear) instead of after a slow upload + a
  // converter 502. Keep these two numbers in lockstep.
  pptx: 150 * 1024 * 1024,
};

// Canonical extension per contentType so a caller can't slip `?evil=/../x`
// into the S3 key via fileName. If a type ever lands here without an entry,
// we fall back to "bin" rather than trusting the fileName suffix.
const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.ms-powerpoint": "ppt",
};

// 300/min per user: a deck import fires one presign per rendered page (capped
// at MAX_DECK_PAGES=200, pdf-to-images.ts) PLUS one for the .pptx source upload
// on the PowerPoint path — so the worst case is 201, and 300 leaves headroom
// for that plus a little concurrent activity without dropping a page to a 429.
// This is a PUT presign for the user's OWN uploads, bounded by the per-object
// size caps below — not a data-exfil vector like the list/GET presign limiter.
const presignLimiter = createLimiter("media-presign", 300, 60_000);

export async function POST(req: Request) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Session expired — please sign in again" }, { status: 401 });
  if (!(await presignLimiter(user.id))) {
    return NextResponse.json({ error: "Too many uploads — slow down" }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const { fileName, contentType, size, purpose } = body as { fileName?: string; contentType?: string; size?: number; purpose?: string };
  if (!fileName || !contentType || typeof size !== "number") return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const safePurpose = purpose === "pptx" || purpose === "media" || purpose === "logo" ? purpose : "media";

  // Purpose-aware max size (defaults to media cap for any unknown purpose).
  const maxBytes = MAX_BYTES[safePurpose] ?? MAX_BYTES.media;
  if (size > maxBytes) {
    const mb = (maxBytes / (1024 * 1024)).toFixed(0);
    return NextResponse.json({ error: `File too large — max ${mb}MB for this upload` }, { status: 400 });
  }

  // Logo purpose accepts only images (nobody uploads a video logo). PPTX
  // only accepts the pptx MIME. Media accepts image + video.
  const allowed = safePurpose === "pptx"
    ? ALLOWED_PPTX
    : safePurpose === "logo"
      ? ALLOWED_IMAGE
      : [...ALLOWED_IMAGE, ...ALLOWED_VIDEO];
  if (!allowed.includes(contentType)) return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });

  // Derive extension from the (already-validated) contentType, NOT from the
  // caller's fileName — prevents traversal / weird-key attacks and forces
  // ext to match MIME so an SVG can't masquerade as an image.
  const ext = EXT_BY_TYPE[contentType] ?? "bin";
  const key = `${user.churchId}/${safePurpose}/${randomUUID()}.${ext}`;
  const url = await presignPut(key, contentType);
  return NextResponse.json({ url, key });
}
