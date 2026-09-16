import { NextResponse } from "next/server";
import { createLimiter } from "@/lib/rate-limit";
import { presignUploadPart } from "@/lib/s3";
import { validatePartNumbers } from "@/lib/media-types";
import { multipartAuth, parseKeyAndUpload } from "../_shared";

export const runtime = "nodejs";

// Parts are signed in batches (≤100 per call); a 5 GB upload needs ≤4 calls,
// retries included 120/min leaves plenty of headroom.
const limiter = createLimiter("media-multipart-parts", 120, 60_000);

export async function POST(req: Request) {
  const user = await multipartAuth(limiter);
  if (user instanceof NextResponse) return user;
  const body = (await req.json().catch(() => ({}))) as { key?: unknown; uploadId?: unknown; partNumbers?: unknown };
  const ref = parseKeyAndUpload(body, user.churchId);
  const nums = validatePartNumbers(body.partNumbers);
  if (!ref || !nums) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const urls: Record<number, string> = {};
  for (const n of nums) urls[n] = await presignUploadPart(ref.key, ref.uploadId, n);
  return NextResponse.json({ urls });
}
