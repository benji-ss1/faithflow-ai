import { NextResponse } from "next/server";
import { apiUser, hasCap } from "@/lib/session";
import { isS3Configured } from "@/lib/s3";
import { ALLOWED_VIDEO_MIME, EXT_BY_TYPE, isChurchUploadKey, isPlausibleUploadId } from "@/lib/media-types";

/**
 * Shared guards for the large-video multipart routes. Every route:
 *   • requires a session (apiUser) with the `edit_library` capability — the
 *     same gate `registerMediaAsset` applies, so no role that can't finish a
 *     large upload can start one — and is rate-limited per user,
 *   • only accepts a key THIS church was issued (`${churchId}/media/<uuid>.<video ext>`),
 *   • only accepts a plausible opaque uploadId.
 * The S3 uploadId is bound to its key by the provider, so a caller can't drive
 * another tenant's upload without that tenant's key — which the prefix check blocks.
 */
const VIDEO_EXTS = new Set(ALLOWED_VIDEO_MIME.map((m) => EXT_BY_TYPE[m]));

export type MultipartUser = { id: string; churchId: string; role: string };

export async function multipartAuth(limiter: (id: string) => Promise<boolean>): Promise<MultipartUser | NextResponse> {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Session expired — please sign in again" }, { status: 401 });
  if (!hasCap(user.role, "edit_library")) return NextResponse.json({ error: "You don't have permission to upload media" }, { status: 403 });
  if (!(await limiter(user.id))) return NextResponse.json({ error: "Too many uploads — slow down" }, { status: 429 });
  if (!isS3Configured()) return NextResponse.json({ error: "Storage not configured" }, { status: 500 });
  return user;
}

export function isChurchVideoKey(key: unknown, churchId: string): key is string {
  if (!isChurchUploadKey(key, churchId, "media")) return false;
  return VIDEO_EXTS.has(key.slice(key.lastIndexOf(".") + 1).toLowerCase());
}

export function parseKeyAndUpload(body: { key?: unknown; uploadId?: unknown }, churchId: string): { key: string; uploadId: string } | null {
  if (!isChurchVideoKey(body.key, churchId) || !isPlausibleUploadId(body.uploadId)) return null;
  return { key: body.key, uploadId: body.uploadId };
}

/**
 * Max in-progress large uploads per church. The count is the HIGHER of
 *   (a) the storage provider's ListMultipartUploads under `${churchId}/media/`
 *       (last 24 h) — holds across serverless instances where supported
 *       (AWS/R2; MinIO ignores directory prefixes), and
 *   (b) this instance's in-memory tracker (create adds, complete/abort remove,
 *       24 h expiry) — always works, but is per-instance.
 * If the provider can't list we fall back to (b) alone; the per-user rate
 * limit + 5 GB cap still bound abuse.
 */
export const MAX_ACTIVE_MULTIPART_PER_CHURCH = 5;
const ACTIVE_TTL_MS = 24 * 3600_000;
const active = new Map<string, Map<string, number>>();

function activeFor(churchId: string): Map<string, number> {
  let m = active.get(churchId);
  if (!m) { m = new Map(); active.set(churchId, m); }
  const cutoff = Date.now() - ACTIVE_TTL_MS;
  for (const [id, at] of m) if (at < cutoff) m.delete(id);
  return m;
}
export function localActiveMultipartCount(churchId: string): number {
  return activeFor(churchId).size;
}
export function trackMultipartStart(churchId: string, uploadId: string): void {
  activeFor(churchId).set(uploadId, Date.now());
}
export function trackMultipartEnd(churchId: string, uploadId: string): void {
  active.get(churchId)?.delete(uploadId);
}
