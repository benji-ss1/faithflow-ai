import { NextResponse } from "next/server";
import { createLimiter } from "@/lib/rate-limit";
import { abortMultipart } from "@/lib/s3";
import { multipartAuth, parseKeyAndUpload, trackMultipartEnd } from "../_shared";

export const runtime = "nodejs";

const limiter = createLimiter("media-multipart-abort", 60, 60_000);

export async function POST(req: Request) {
  const user = await multipartAuth(limiter);
  if (user instanceof NextResponse) return user;
  const body = (await req.json().catch(() => ({}))) as { key?: unknown; uploadId?: unknown };
  const ref = parseKeyAndUpload(body, user.churchId);
  if (!ref) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  // Best-effort: releases the stored parts. A bucket lifecycle rule
  // (AbortIncompleteMultipartUpload) is the backstop for tabs closed mid-upload.
  await abortMultipart(ref.key, ref.uploadId).catch(() => {});
  trackMultipartEnd(user.churchId, ref.uploadId);
  return NextResponse.json({ ok: true });
}
