import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let _client: S3Client | null = null;

export function s3() {
  if (_client) return _client;
  _client = new S3Client({
    region: process.env.AWS_REGION!,
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: !!process.env.S3_ENDPOINT,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
  return _client;
}

export const BUCKET = () => process.env.S3_BUCKET!;

export async function presignPut(key: string, contentType: string, expiresSec = 300) {
  const cmd = new PutObjectCommand({ Bucket: BUCKET(), Key: key, ContentType: contentType });
  return getSignedUrl(s3(), cmd, { expiresIn: expiresSec });
}

export function isS3Configured() {
  return !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.S3_BUCKET);
}

// Default 6 hours — long enough that a service's slides don't 404 mid-way
// through if the operator's page was loaded before the service started.
// If AWS bumps their max later, callers can override per-call.
export async function presignGet(key: string, expiresSec = 6 * 3600) {
  if (!key || !isS3Configured()) return "";
  try {
    const cmd = new GetObjectCommand({ Bucket: BUCKET(), Key: key });
    return await getSignedUrl(s3(), cmd, { expiresIn: expiresSec });
  } catch {
    return "";
  }
}

/**
 * Given one of OUR presigned GET URLs, return the stable object key
 * ({churchId}/media/{uuid}.ext) so it can be re-signed fresh. Returns null for
 * non-presigned or external URLs (those are left untouched by callers).
 */
export function keyFromPresignedUrl(url: string): string | null {
  if (!url || !isS3Configured()) return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  // Only ever touch SigV4-presigned URLs — never an external/plain image URL.
  if (!u.searchParams.has("X-Amz-Signature")) return null;
  // Host must be ours: the custom endpoint host, or the object's AWS host.
  const endpoint = process.env.S3_ENDPOINT;
  if (endpoint) {
    try { if (u.host !== new URL(endpoint).host) return null; } catch { return null; }
  } else if (!u.host.includes(".amazonaws.com")) {
    return null;
  }
  let path = decodeURIComponent(u.pathname).replace(/^\/+/, "");
  const bucket = BUCKET();
  if (path === bucket) return null;
  // Path-style URLs (custom endpoint / forcePathStyle) carry the bucket as the
  // leading path segment; virtual-hosted AWS URLs don't. Strip it if present.
  if (path.startsWith(bucket + "/")) path = path.slice(bucket.length + 1);
  return path || null;
}

/**
 * Re-sign an expiring media URL. If it's one of our presigned URLs, mint a fresh
 * presign for the same key (resetting the 6h TTL); otherwise return unchanged.
 * Lets stored theme backgrounds/logos survive past the original presign window.
 */
export async function refreshPresignedUrl(url: string): Promise<string> {
  const key = keyFromPresignedUrl(url);
  if (!key) return url;
  const fresh = await presignGet(key);
  return fresh || url;
}

export async function deleteObject(key: string) {
  await s3().send(new DeleteObjectCommand({ Bucket: BUCKET(), Key: key }));
}

export async function putBuffer(key: string, body: Buffer, contentType: string) {
  await s3().send(new PutObjectCommand({ Bucket: BUCKET(), Key: key, Body: body, ContentType: contentType }));
}
