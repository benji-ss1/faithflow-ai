import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { apiUser } from "@/lib/session";
import { createLimiter } from "@/lib/rate-limit";
import { presignPut } from "@/lib/s3";

const ALLOWED_IMAGE = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ALLOWED_VIDEO = ["video/mp4", "video/webm", "video/quicktime"];
const ALLOWED_PPTX = ["application/vnd.openxmlformats-officedocument.presentationml.presentation"];
const MAX_SIZE = 500 * 1024 * 1024;

// Canonical extension per contentType so a caller can't slip `?evil=/../x`
// into the S3 key via fileName. If a type ever lands here without an entry,
// we fall back to "bin" rather than trusting the fileName suffix.
const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

const presignLimiter = createLimiter("media-presign", 60, 60_000);

export async function POST(req: Request) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Session expired — please sign in again" }, { status: 401 });
  if (!(await presignLimiter(user.id))) {
    return NextResponse.json({ error: "Too many uploads — slow down" }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const { fileName, contentType, size, purpose } = body as { fileName?: string; contentType?: string; size?: number; purpose?: string };
  if (!fileName || !contentType || typeof size !== "number") return NextResponse.json({ error: "Bad request" }, { status: 400 });
  if (size > MAX_SIZE) return NextResponse.json({ error: "File too large" }, { status: 400 });

  const allowed = purpose === "pptx" ? ALLOWED_PPTX : [...ALLOWED_IMAGE, ...ALLOWED_VIDEO];
  if (!allowed.includes(contentType)) return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });

  // Derive extension from the (already-validated) contentType, NOT from the
  // caller's fileName — prevents traversal / weird-key attacks and forces
  // ext to match MIME so an SVG can't masquerade as an image.
  const ext = EXT_BY_TYPE[contentType] ?? "bin";
  const safePurpose = purpose === "pptx" || purpose === "media" ? purpose : "media";
  const key = `${user.churchId}/${safePurpose}/${randomUUID()}.${ext}`;
  const url = await presignPut(key, contentType);
  return NextResponse.json({ url, key });
}
