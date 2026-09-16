import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createLimiter } from "@/lib/rate-limit";
import { createMultipart } from "@/lib/s3";
import { buildUploadKey, validateMultipartCreate, MEDIA_MULTIPART_PART_BYTES } from "@/lib/media-types";
import { multipartAuth } from "../_shared";

export const runtime = "nodejs";

// Starting a large upload is rare (one per big video) — 30/min is generous.
const limiter = createLimiter("media-multipart-create", 30, 60_000);

export async function POST(req: Request) {
  const user = await multipartAuth(limiter);
  if (user instanceof NextResponse) return user;
  const body = (await req.json().catch(() => ({}))) as { contentType?: unknown; size?: unknown };
  const v = validateMultipartCreate(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  // Key is built server-side with the church prefix — never from the client.
  const key = buildUploadKey(user.churchId, "media", randomUUID(), v.contentType);
  try {
    const uploadId = await createMultipart(key, v.contentType);
    return NextResponse.json({ key, uploadId, partSize: MEDIA_MULTIPART_PART_BYTES, parts: v.parts });
  } catch {
    return NextResponse.json({ error: "Couldn't start the upload — try again" }, { status: 502 });
  }
}
