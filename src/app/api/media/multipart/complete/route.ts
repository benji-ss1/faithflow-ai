import { NextResponse } from "next/server";
import { createLimiter } from "@/lib/rate-limit";
import { completeMultipart, headObject, deleteObject } from "@/lib/s3";
import { validateCompletedParts, MEDIA_MULTIPART_MAX_BYTES } from "@/lib/media-types";
import { multipartAuth, parseKeyAndUpload } from "../_shared";

export const runtime = "nodejs";

const limiter = createLimiter("media-multipart-complete", 60, 60_000);

export async function POST(req: Request) {
  const user = await multipartAuth(limiter);
  if (user instanceof NextResponse) return user;
  const body = (await req.json().catch(() => ({}))) as { key?: unknown; uploadId?: unknown; parts?: unknown };
  const ref = parseKeyAndUpload(body, user.churchId);
  const parts = validateCompletedParts(body.parts);
  if (!ref || !parts) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  try {
    await completeMultipart(ref.key, ref.uploadId, parts);
  } catch {
    return NextResponse.json({ error: "Couldn't finish the upload — try again" }, { status: 502 });
  }
  // Presigned part URLs can't cap bytes — enforce the ceiling on the assembled
  // object. (registerMediaAsset re-checks size + magic bytes too.)
  const meta = await headObject(ref.key);
  if (meta && meta.size > MEDIA_MULTIPART_MAX_BYTES) {
    await deleteObject(ref.key).catch(() => {});
    return NextResponse.json({ error: "File too large" }, { status: 400 });
  }
  return NextResponse.json({ key: ref.key });
}
