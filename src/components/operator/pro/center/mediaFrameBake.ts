/**
 * Bake a SAVED media frame (crop / pan / zoom / blur-fill / logo-on-background)
 * into a real 1920×1080 image, so it can be used as a BACKGROUND.
 *
 * Why: "Send as slide" already projects a saved frame (buildMediaFrameSlide → objects),
 * but every BACKGROUND path — Set as global background, Set as current slide's
 * background, drag-onto-slide, the hover "Bg" — takes a single image URL and used
 * the ORIGINAL file, so the operator's edit was silently thrown away (Victor,
 * 2026-09-19). A background is just a URL to ~6 different renderers, so instead of
 * teaching each one about frames we make the edit a real image once and hand them
 * that URL. Every surface (projector, stage, thumbnails, OBS) then matches the editor.
 *
 * The drawing mirrors SlideObjectsLayer's image/shape rules (object-fit +
 * object-position + zoom about the pan point; blur-fill backdrop) and is driven by
 * buildMediaFrameSlide's own object list — one source of truth for what a frame is.
 */
import { CANVAS_W, CANVAS_H, type SlideObject, type ImageObject, type ShapeObject } from "@/lib/slide-objects";
import { registerMediaAsset, deleteMediaAsset } from "@/lib/actions";
import { loadMediaFrame, buildMediaFrameSlide, type MediaFrame } from "./mediaFrame";
import { BAKE_BLUR_FILTER, bakeBlurFilter, isTrivialFrame, frameHash, fitRect, gradientLine } from "./mediaFrameBakeMath";

export { BAKE_BLUR_FILTER, bakeBlurFilter, isTrivialFrame, frameHash, fitRect, gradientLine };

function drawImageObject(ctx: CanvasRenderingContext2D, img: HTMLImageElement, o: ImageObject, scale: number) {
  const blurFilter = bakeBlurFilter(scale);
  const iw = img.naturalWidth, ih = img.naturalHeight;
  if (!iw || !ih) return;
  const fit = o.fit ?? "contain";
  const px = o.posX ?? 50, py = o.posY ?? 50;
  ctx.save();
  ctx.beginPath(); ctx.rect(o.x, o.y, o.w, o.h); ctx.clip();
  const aboutCentre = (fn: () => void, ox: number, oy: number, scale: number) => {
    ctx.save(); ctx.translate(ox, oy); ctx.scale(scale, scale); ctx.translate(-ox, -oy); fn(); ctx.restore();
  };
  const drawCover = () => { const r = fitRect(iw, ih, o.x, o.y, o.w, o.h, "cover", 50, 50); ctx.drawImage(img, r.dx, r.dy, r.dw, r.dh); };
  if (o.blurFill === true && fit === "contain") {
    ctx.filter = blurFilter;
    aboutCentre(drawCover, o.x + o.w / 2, o.y + o.h / 2, 1.15);
    ctx.filter = "none";
  }
  const r = fitRect(iw, ih, o.x, o.y, o.w, o.h, fit, px, py);
  const ox = o.x + (o.w * px) / 100, oy = o.y + (o.h * py) / 100;
  if (o.blur) {
    ctx.filter = blurFilter;
    aboutCentre(() => ctx.drawImage(img, r.dx, r.dy, r.dw, r.dh), ox, oy, 1.15);
    ctx.filter = "none";
  } else {
    ctx.globalAlpha = o.opacity ?? 1;
    aboutCentre(() => ctx.drawImage(img, r.dx, r.dy, r.dw, r.dh), ox, oy, o.zoom && o.zoom !== 1 ? o.zoom : 1);
  }
  ctx.restore();
}

function drawShapeObject(ctx: CanvasRenderingContext2D, o: ShapeObject) {
  ctx.save();
  if (o.fill2) {
    const g = gradientLine(o.fillAngle ?? 135, o.x, o.y, o.w, o.h);
    const grad = ctx.createLinearGradient(g.x0, g.y0, g.x1, g.y1);
    grad.addColorStop(0, o.fill ?? "#14b8a6"); grad.addColorStop(1, o.fill2);
    ctx.fillStyle = grad;
  } else ctx.fillStyle = o.fill ?? "#14b8a6";
  ctx.fillRect(o.x, o.y, o.w, o.h);
  ctx.restore();
}

/**
 * Draw the frame in 1920×1080 canvas units. `transparent` = theme-background frames keep alpha.
 * For a smaller canvas (thumbnails) call ctx.scale(w/1920, w/1920) first and pass that
 * factor as `scale`, so the blur radius shrinks with it.
 */
export function drawFrame(ctx: CanvasRenderingContext2D, frame: MediaFrame, img: HTMLImageElement, scale = 1): { transparent: boolean } {
  const { bgColor, objects } = buildMediaFrameSlide(frame, img.src);
  const transparent = bgColor === undefined;
  if (!transparent) { ctx.fillStyle = bgColor; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H); }
  for (const raw of objects as SlideObject[]) {
    if (raw.kind === "shape") drawShapeObject(ctx, raw as ShapeObject);
    else if (raw.kind === "image") drawImageObject(ctx, img, raw as ImageObject, scale);
  }
  return { transparent };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    const t = window.setTimeout(() => reject(new Error("Image load timed out")), 12000);
    im.onload = () => { window.clearTimeout(t); resolve(im); };
    im.onerror = () => { window.clearTimeout(t); reject(new Error("Couldn't load the image")); };
    im.src = url;
  });
}

async function uploadBaked(blob: Blob, fileName: string, mime: string): Promise<{ id: string; url: string; key: string }> {
  const presignRes = await fetch("/api/media/presign", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName, contentType: mime, size: blob.size, purpose: "media" }),
  });
  if (!presignRes.ok) throw new Error(`Presign failed (${presignRes.status})`);
  const { url: uploadUrl, key } = (await presignRes.json()) as { url: string; key: string };
  const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": mime }, body: blob });
  if (!put.ok) throw new Error("Storage upload failed");
  const reg = await registerMediaAsset({ kind: "image", fileName, s3Key: key, mimeType: mime, sizeBytes: blob.size });
  if (!reg?.ok || !reg.data) throw new Error("Registration failed");
  return { id: reg.data.id, url: await signedUrl(key), key };
}

async function signedUrl(key: string): Promise<string> {
  const r = await fetch("/api/media/url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
  if (!r.ok) throw new Error("Could not get media URL");
  return ((await r.json()) as { url: string }).url;
}

type BakeCache = { hash: string; assetId: string; key: string };
const cacheKey = (churchId: string | undefined, assetId: string) => `pf.mediaFrameBake.v1.${churchId || "default"}.${assetId}`;
function readCache(churchId: string | undefined, assetId: string): BakeCache | null {
  try { const raw = window.localStorage.getItem(cacheKey(churchId, assetId)); return raw ? (JSON.parse(raw) as BakeCache) : null; } catch { return null; }
}
function writeCache(churchId: string | undefined, assetId: string, c: BakeCache) {
  try { window.localStorage.setItem(cacheKey(churchId, assetId), JSON.stringify(c)); } catch { /* non-fatal */ }
}

export interface FramedBackground { url: string; mediaKey?: string; baked: boolean; /** a saved frame exists but couldn't be applied — the original was used */ failed?: boolean }

/**
 * The URL to use when this media item becomes a BACKGROUND. No saved frame (or a
 * trivial one) → the original, exactly as before. A real frame → a baked image of
 * it, reused until the frame is edited again. Never throws: any failure falls back
 * to the original so setting a background can never break.
 */
export async function resolveFramedBackground(
  churchId: string | undefined,
  asset: { id: string; url: string; fileName?: string; mediaKey?: string },
): Promise<FramedBackground> {
  const original: FramedBackground = { url: asset.url, ...(asset.mediaKey ? { mediaKey: asset.mediaKey } : {}), baked: false };
  if (typeof window === "undefined" || !churchId) return original;
  const frame = loadMediaFrame(churchId, asset.id);
  if (!frame || isTrivialFrame(frame)) return original;
  const hash = frameHash(frame);
  const cached = readCache(churchId, asset.id);
  try {
    if (cached && cached.hash === hash) return { url: await signedUrl(cached.key), mediaKey: cached.key, baked: true };
  } catch { /* fall through and re-bake */ }
  try {
    const img = await loadImage(asset.url);
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_W; canvas.height = CANVAS_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ...original, failed: true };
    const { transparent } = drawFrame(ctx, frame, img);
    const mime = transparent ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, mime, 0.92));
    if (!blob) return { ...original, failed: true };
    const base = (asset.fileName || "image").replace(/\.[^.]+$/, "");
    const up = await uploadBaked(blob, `${base} (framed).${transparent ? "png" : "jpg"}`, mime);
    writeCache(churchId, asset.id, { hash, assetId: up.id, key: up.key });
    if (cached && cached.assetId !== up.id) void deleteMediaAsset(cached.assetId).catch(() => { /* orphan cleanup is best-effort */ });
    return { url: up.url, mediaKey: up.key, baked: true };
  } catch {
    return { ...original, failed: true };
  }
}

/** Sync check: does this asset have a saved frame that needs baking? (lets a caller
 *  skip painting the raw image first, which would flash the wrong picture). */
export function hasBakeableFrame(churchId: string | undefined, assetId: string): boolean {
  if (typeof window === "undefined" || !churchId) return false;
  const f = loadMediaFrame(churchId, assetId);
  return !!f && !isTrivialFrame(f);
}
