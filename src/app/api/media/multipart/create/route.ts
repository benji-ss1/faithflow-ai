import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createLimiter } from "@/lib/rate-limit";
import { createMultipart, countRecentMultipartUploads } from "@/lib/s3";
import { buildUploadKey, validateMultipartCreate, MEDIA_MULTIPART_PART_BYTES } from "@/lib/media-types";
import { multipartAuth, MAX_ACTIVE_MULTIPART_PER_CHURCH, localActiveMultipartCount, trackMultipartStart } from "../_shared";

export const runtime = "nodejs";

// Starting a large upload is rare (one per big video) — 30/min is generous.
const limiter = createLimiter("media-multipart-create", 30, 60_000);

export async function POST(req: Request) {
  const user = await multipartAuth(limiter);
  if (user instanceof NextResponse) return user;
  const body = (await req.json().catch(() => ({}))) as { contentType?: unknown; size?: unknown };
  const v = validateMultipartCreate(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const listed = await countRecentMultipartUploads(`${user.churchId}/media/`, Date.now() - 24 * 3600_000).catch(() => 0);
  const active = Math.max(listed, localActiveMultipartCount(user.churchId));
  if (active >= MAX_ACTIVE_MULTIPART_PER_CHURCH) {
    return NextResponse.json({ error: "Too many large uploads in progress — let one finish first" }, { status: 429 });
  }
  // Key is built server-side with the church prefix — never from the client.
  const key = buildUploadKey(user.churchId, "media", randomUUID(), v.contentType);
  try {
    const uploadId = await createMultipart(key, v.contentType);
    trackMultipartStart(user.churchId, uploadId);
    return NextResponse.json({ key, uploadId, partSize: MEDIA_MULTIPART_PART_BYTES, parts: v.parts });
  } catch {
    return NextResponse.json({ error: "Couldn't start the upload — try again" }, { status: 502 });
  }
}
