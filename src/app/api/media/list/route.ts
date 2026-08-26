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
  const withUrls = await Promise.all(media.map(async (m) => {
    // `url` is the full-res original — used for PROJECTION (must stay high-res).
    // `thumbUrl` is the small grid preview (falls back to the original when no
    // thumbnail has been generated yet, e.g. pre-backfill or a video). The grid
    // renders thumbUrl; projection uses url. presignGet is a local HMAC (cheap),
    // so signing both per asset is negligible.
    const [url, thumbUrl] = await Promise.all([
      presignGet(m.s3Key),
      presignGet(m.thumbS3Key ?? m.s3Key),
    ]);
    return {
      id: m.id,
      fileName: m.fileName,
      kind: m.kind,
      sizeBytes: m.sizeBytes,
      createdAt: m.createdAt.toISOString(),
      url,
      thumbUrl,
    };
  }));
  return NextResponse.json({ assets: withUrls });
}
