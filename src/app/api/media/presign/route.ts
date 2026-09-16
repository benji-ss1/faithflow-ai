import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { apiUser, hasCap } from "@/lib/session";
import { createLimiter } from "@/lib/rate-limit";
import { presignPut } from "@/lib/s3";
import { MAX_BYTES, allowedMimesForPurpose, buildUploadKey, kindForMime } from "@/lib/media-types";
import { isAudioMediaSupported, AUDIO_NOT_READY_ERROR } from "@/lib/server/media-audio-support";

// Allowlists, caps and extension mapping live in ONE shared module so the
// presign route, the multipart routes and registerMediaAsset can never drift.
// (SVG stays excluded — XSS vector; HEIC is converted to JPEG client-side.)

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

  // Capability gate per purpose, mirroring what each upload is used for:
  //   pptx  → edit_library (createPptxImport / deck import)
  //   logo  → manage_church OR edit_library (Layers panel theme-logo swap)
  //   media → edit_library OR operate_services (operators/volunteers upload
  //           backgrounds from the operator console via lib/media-upload.ts)
  const allowedRole =
    safePurpose === "pptx" ? hasCap(user.role, "edit_library")
    // logo: admins (church branding) AND library editors — operators swap the
    // theme logo from the Layers panel (LayersPanel → uploadImageFile "logo").
    : safePurpose === "logo" ? hasCap(user.role, "manage_church") || hasCap(user.role, "edit_library")
    : hasCap(user.role, "edit_library") || hasCap(user.role, "operate_services");
  if (!allowedRole) return NextResponse.json({ error: "You don't have permission to upload this" }, { status: 403 });

  // Purpose-aware max size (defaults to media cap for any unknown purpose).
  const maxBytes = MAX_BYTES[safePurpose];
  if (size > maxBytes) {
    const mb = (maxBytes / (1024 * 1024)).toFixed(0);
    return NextResponse.json({ error: `File too large — max ${mb}MB for this upload` }, { status: 400 });
  }

  // Logo → images only; pptx → PowerPoint only; media → image + video + audio.
  const allowed = allowedMimesForPurpose(safePurpose);
  if (!allowed.includes(contentType)) return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  // Audio is gated on the additive media_kind migration — refuse BEFORE the
  // upload so nothing is stored that can't be registered.
  if (kindForMime(contentType) === "audio" && !(await isAudioMediaSupported())) {
    return NextResponse.json({ error: AUDIO_NOT_READY_ERROR }, { status: 400 });
  }

  // Extension derives from the validated contentType, never the fileName.
  const key = buildUploadKey(user.churchId, safePurpose, randomUUID(), contentType);
  const url = await presignPut(key, contentType);
  return NextResponse.json({ url, key });
}
