import { NextResponse } from "next/server";
import { apiUser } from "@/lib/session";
import { isS3Configured } from "@/lib/s3";
import { ALLOWED_VIDEO_MIME, EXT_BY_TYPE, isChurchUploadKey, isPlausibleUploadId } from "@/lib/media-types";

/**
 * Shared guards for the large-video multipart routes. Every route:
 *   • requires a session (apiUser) and is rate-limited per user,
 *   • only accepts a key THIS church was issued (`${churchId}/media/<uuid>.<video ext>`),
 *   • only accepts a plausible opaque uploadId.
 * The S3 uploadId is bound to its key by the provider, so a caller can't drive
 * another tenant's upload without that tenant's key — which the prefix check blocks.
 */
const VIDEO_EXTS = new Set(ALLOWED_VIDEO_MIME.map((m) => EXT_BY_TYPE[m]));

export type MultipartUser = { id: string; churchId: string };

export async function multipartAuth(limiter: (id: string) => Promise<boolean>): Promise<MultipartUser | NextResponse> {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Session expired — please sign in again" }, { status: 401 });
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
