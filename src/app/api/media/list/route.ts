import { NextResponse } from "next/server";
import { apiUser } from "@/lib/session";
import { createLimiter } from "@/lib/rate-limit";
import { listMedia } from "@/lib/server/services";
import { presignGet } from "@/lib/s3";

export const runtime = "nodejs";

// 30/min is generous for interactive library browsing but blocks a script
// that mints fresh 6h-TTL presigned URLs on every call to outlive a session
// downgrade / tier expiry.
const mediaListLimiter = createLimiter("media-list", 30, 60_000);

export async function GET() {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await mediaListLimiter(user.id))) {
    return NextResponse.json({ error: "Too many media list requests — slow down" }, { status: 429 });
  }
  const media = await listMedia(user.churchId);
  const withUrls = await Promise.all(media.map(async (m) => ({
    id: m.id,
    fileName: m.fileName,
    kind: m.kind,
    sizeBytes: m.sizeBytes,
    createdAt: m.createdAt.toISOString(),
    url: await presignGet(m.s3Key),
  })));
  return NextResponse.json({ assets: withUrls });
}
