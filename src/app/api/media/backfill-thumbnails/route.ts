import { NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { apiUser } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { mediaAssets } from "@/lib/db/schema";
import { createLimiter } from "@/lib/rate-limit";
import { getBuffer, putBuffer } from "@/lib/s3";
import { generateImageThumbnail } from "@/lib/media-thumbnail";

export const runtime = "nodejs";
export const maxDuration = 60;

// Generate grid thumbnails for this church's PRE-EXISTING image assets (rows
// that predate the on-upload thumbnail step, so thumb_s3_key IS NULL). New
// uploads already self-thumbnail in registerMediaAsset. This is idempotent and
// BOUNDED — it processes at most BATCH rows per call and reports how many
// remain, so the client (MediaBrowser) can loop until `remaining` hits 0
// without ever holding a long request open or re-doing finished work.
const BATCH = 20;
const backfillLimiter = createLimiter("media-thumb-backfill", 30, 60_000);

export async function POST() {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await backfillLimiter(user.id))) {
    return NextResponse.json({ error: "Too many requests — slow down" }, { status: 429 });
  }
  const db = getDb();

  // Only image rows can be thumbnailed (videos stay null and fall back). Scope
  // strictly to THIS church.
  const missing = and(
    eq(mediaAssets.churchId, user.churchId),
    eq(mediaAssets.kind, "image"),
    isNull(mediaAssets.thumbS3Key),
  );

  const batch = await db.select().from(mediaAssets).where(missing).limit(BATCH);

  // Every selected row leaves the `missing` set this pass — either with a real
  // thumbnail, or with a SENTINEL (thumb_s3_key = s3Key) meaning "can't/won't
  // thumbnail this one, serve the original". Without the sentinel, an orphaned
  // key or an undecodable image would keep `remaining` above 0 forever and the
  // client would re-run the backfill loop on every mount doing zero real work.
  let processed = 0;
  for (const m of batch) {
    let thumbKey = m.s3Key; // sentinel default = "no thumb, use original"
    try {
      const original = await getBuffer(m.s3Key);
      if (original) {
        const thumb = await generateImageThumbnail(original, m.mimeType);
        if (thumb) {
          thumbKey = `${m.s3Key}.thumb.jpg`;
          await putBuffer(thumbKey, thumb.buffer, thumb.mimeType);
          processed++;
        }
      }
    } catch { thumbKey = m.s3Key; /* fall back to sentinel */ }
    // Always stamp SOMETHING so the row drops out of `missing` and the loop
    // converges (church-scoped).
    await db.update(mediaAssets)
      .set({ thumbS3Key: thumbKey })
      .where(and(eq(mediaAssets.id, m.id), eq(mediaAssets.churchId, user.churchId)));
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(mediaAssets)
    .where(missing);

  return NextResponse.json({ processed, remaining: count });
}
