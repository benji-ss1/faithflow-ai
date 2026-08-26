/**
 * Server-side thumbnail generation for media assets uploaded during
 * ProPresenter import (and any other media path that wants a browse-grid
 * preview).
 *
 * Design constraints:
 *   - Runs on Vercel serverless (Fluid Compute) — no ffmpeg spawn beyond
 *     what's already in ffmpeg-static, no shelling out.
 *   - Images: @napi-rs/canvas is already loaded elsewhere (pptx.ts) so
 *     no new dep is added.
 *   - Videos: we do NOT frame-grab in the request path. Browser <video>
 *     already renders first-frame via the `poster` attr or the video
 *     itself for a preview; adding ffmpeg-in-serverless would blow the
 *     time budget on a large import. Video rows get `thumbS3Key = null`
 *     and the browser falls back gracefully.
 *
 * Output format: JPEG at quality 78, target ~320x180 (16:9) with
 * aspect-preserving letterbox — the size the Media Browser + song row
 * preview both render at.
 */

const THUMB_WIDTH = 320;
const THUMB_HEIGHT = 180;
const THUMB_QUALITY = 78;

export type ThumbnailResult = {
  buffer: Buffer;
  mimeType: "image/jpeg";
  width: number;
  height: number;
};

/**
 * Generate a 320x180 JPEG thumbnail from an image buffer. Returns null
 * on any failure — the caller stores the media without a thumbnail and
 * the browser renders the full image instead.
 */
export async function generateImageThumbnail(
  source: Buffer,
  mimeType: string,
): Promise<ThumbnailResult | null> {
  // Only handle raster image types napi-rs/canvas can decode natively (incl.
  // AVIF — which is on the upload allowlist, so it must be thumbnailable or its
  // rows would never leave the backfill queue). SVGs render fine in the browser
  // without a thumbnail — skip them (a bad decode still fails soft below).
  if (!/^image\/(png|jpeg|jpg|gif|webp|avif)$/i.test(mimeType)) return null;

  try {
    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const img = await loadImage(source);
    const srcW = img.width;
    const srcH = img.height;
    if (!srcW || !srcH) return null;

    // Aspect-preserving cover-fit: fill 320x180, crop overflow centered.
    const scale = Math.max(THUMB_WIDTH / srcW, THUMB_HEIGHT / srcH);
    const drawW = srcW * scale;
    const drawH = srcH * scale;
    const dx = (THUMB_WIDTH - drawW) / 2;
    const dy = (THUMB_HEIGHT - drawH) / 2;

    const canvas = createCanvas(THUMB_WIDTH, THUMB_HEIGHT);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);
    ctx.drawImage(img, dx, dy, drawW, drawH);

    const jpeg = await canvas.encode("jpeg", THUMB_QUALITY);
    return { buffer: jpeg, mimeType: "image/jpeg", width: THUMB_WIDTH, height: THUMB_HEIGHT };
  } catch {
    return null;
  }
}
