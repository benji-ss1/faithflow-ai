import {
  S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand,
  CreateMultipartUploadCommand, UploadPartCommand, ListMultipartUploadsCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
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
  let path: string;
  try { path = decodeURIComponent(u.pathname).replace(/^\/+/, ""); } catch { return null; }
  const bucket = BUCKET();
  // A custom endpoint may itself carry a path (Supabase: /storage/v1/s3). Path-
  // style presigned URLs are <endpointPath>/<bucket>/<key>. Previously only a
  // leading "<bucket>/" was stripped, so on such endpoints the key kept the
  // "storage/v1/s3/<bucket>/" prefix and EVERY re-sign nested it one level
  // deeper (2026-09-17 prod: a theme logoUrl with the prefix repeated 5×).
  // Strip the endpoint path + bucket repeatedly — idempotent, and it heals
  // already-nested stored URLs back to the real key.
  let endpointPath = "";
  if (endpoint) {
    try { endpointPath = decodeURIComponent(new URL(endpoint).pathname).replace(/^\/+|\/+$/g, ""); } catch { /* none */ }
  }
  for (let guard = 0; guard < 16; guard++) {
    if (endpointPath && path.startsWith(endpointPath + "/")) { path = path.slice(endpointPath.length + 1); continue; }
    if (path.startsWith(bucket + "/")) { path = path.slice(bucket.length + 1); continue; }
    break;
  }
  if (!path || path === bucket || path === endpointPath) return null;
  // Encoded slashes (%2F) survive URL normalisation and decode here, so a key
  // could carry "../" segments that pass a "{churchId}/" prefix check while
  // pointing at another church's object. Refuse any dot segment, absolute
  // path or backslash — our real keys never contain them.
  if (path.startsWith("/") || path.includes("\\") || path.split("/").some((seg) => seg === ".." || seg === ".")) return null;
  return path;
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

/**
 * Delete an object — PRODUCTION ONLY.
 *
 * Storage is SHARED between production and preview deployments (S3_ENDPOINT,
 * AWS_* and S3_BUCKET are all scoped "Production, Preview" in Vercel), and this
 * is a hard delete. So before this guard, a tester poking at a preview could
 * permanently destroy a real church's uploaded media — sermon graphics and
 * background videos are the one asset class with no upstream copy, and the
 * real Sunday plan referencing them would then render a hole.
 *
 * The storage provider is Supabase (a custom S3-compatible endpoint), which has
 * no bucket versioning, so there is NO undo. That makes this an application
 * guard rather than a permissions one — there is no per-action IAM policy to
 * lean on here.
 *
 * A refused delete is SAFE: every caller already tolerates failure and treats
 * the leftover file as an orphan ("orphan — recoverable" in actions.ts). So the
 * worst outcome outside production is an unused file, never a lost one.
 *
 * VERCEL_ENV is set by Vercel itself and cannot be forged by a request. Local
 * development has no VERCEL_ENV, and is allowed through so `npm run dev`
 * against a local/dev bucket still behaves normally.
 */
export function deletesAllowed(): boolean {
  const env = process.env.VERCEL_ENV;
  if (!env) return true;             // local dev — not a hosted deployment
  return env === "production";
}

export async function deleteObject(key: string) {
  if (!deletesAllowed()) {
    // Throw rather than silently no-op: callers catch this and log an orphan,
    // and a silent success would tell the operator the file was removed when it
    // was not.
    throw new Error(
      `Refusing to delete storage object on a non-production deployment (VERCEL_ENV=${process.env.VERCEL_ENV}). `
      + `Storage is shared with production and has no versioning, so this would destroy a real file.`,
    );
  }
  await s3().send(new DeleteObjectCommand({ Bucket: BUCKET(), Key: key }));
}

export async function putBuffer(key: string, body: Buffer, contentType: string) {
  await s3().send(new PutObjectCommand({ Bucket: BUCKET(), Key: key, Body: body, ContentType: contentType }));
}

/** Fetch an object's bytes as a Buffer. Used server-side to generate a
 *  thumbnail from an already-uploaded original. Returns null on any failure
 *  (missing object, transport error) so callers can degrade gracefully. */
export async function getBuffer(key: string): Promise<Buffer | null> {
  if (!key || !isS3Configured()) return null;
  try {
    const res = await s3().send(new GetObjectCommand({ Bucket: BUCKET(), Key: key }));
    const bytes = await res.Body?.transformToByteArray();
    return bytes ? Buffer.from(bytes) : null;
  } catch {
    return null;
  }
}

/** HEAD an object: real stored size + content-type. null if missing / error. */
export async function headObject(key: string): Promise<{ size: number; contentType?: string } | null> {
  if (!key || !isS3Configured()) return null;
  try {
    const res = await s3().send(new HeadObjectCommand({ Bucket: BUCKET(), Key: key }));
    return { size: Number(res.ContentLength ?? 0), contentType: res.ContentType };
  } catch {
    return null;
  }
}

/** Ranged GET of the first `bytes` bytes (magic-byte sniffing). */
export async function getObjectHead(key: string, bytes = 64): Promise<Uint8Array | null> {
  if (!key || !isS3Configured()) return null;
  try {
    const res = await s3().send(new GetObjectCommand({ Bucket: BUCKET(), Key: key, Range: `bytes=0-${bytes - 1}` }));
    const arr = await res.Body?.transformToByteArray();
    return arr ? arr.subarray(0, bytes) : null;
  } catch {
    return null;
  }
}

function isNotFound(e: unknown): boolean {
  const err = e as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return err?.name === "NotFound" || err?.name === "NoSuchKey" || err?.Code === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404;
}

/**
 * Strict HEAD for verification: null ONLY when the object doesn't exist; any
 * other failure (network, 5xx, throttling) THROWS so callers never mistake a
 * transient error for "missing" and delete a good upload.
 */
export async function statObject(key: string): Promise<{ size: number; contentType?: string } | null> {
  if (!isS3Configured()) throw new Error("Storage not configured");
  try {
    const res = await s3().send(new HeadObjectCommand({ Bucket: BUCKET(), Key: key }));
    return { size: Number(res.ContentLength ?? 0), contentType: res.ContentType };
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

/** Strict ranged GET of the first `bytes` bytes — THROWS on any failure. */
export async function readObjectHead(key: string, bytes: number): Promise<Uint8Array> {
  if (!isS3Configured()) throw new Error("Storage not configured");
  const res = await s3().send(new GetObjectCommand({ Bucket: BUCKET(), Key: key, Range: `bytes=0-${bytes - 1}` }));
  const arr = await res.Body?.transformToByteArray();
  if (!arr) throw new Error("Empty body");
  return arr.subarray(0, bytes);
}

/** In-progress multipart uploads under a prefix initiated after `sinceMs`. */
export async function countRecentMultipartUploads(prefix: string, sinceMs: number): Promise<number> {
  const res = await s3().send(new ListMultipartUploadsCommand({ Bucket: BUCKET(), Prefix: prefix, MaxUploads: 100 }));
  return (res.Uploads ?? []).filter((u) => !u.Initiated || u.Initiated.getTime() >= sinceMs).length;
}

// ── Multipart (large video uploads) ────────────────────────────────────────────
export async function createMultipart(key: string, contentType: string): Promise<string> {
  const res = await s3().send(new CreateMultipartUploadCommand({ Bucket: BUCKET(), Key: key, ContentType: contentType }));
  if (!res.UploadId) throw new Error("No upload id");
  return res.UploadId;
}

export async function presignUploadPart(key: string, uploadId: string, partNumber: number, expiresSec = 3600) {
  const cmd = new UploadPartCommand({ Bucket: BUCKET(), Key: key, UploadId: uploadId, PartNumber: partNumber });
  return getSignedUrl(s3(), cmd, { expiresIn: expiresSec });
}

export async function completeMultipart(key: string, uploadId: string, parts: { PartNumber: number; ETag: string }[]) {
  await s3().send(new CompleteMultipartUploadCommand({ Bucket: BUCKET(), Key: key, UploadId: uploadId, MultipartUpload: { Parts: parts } }));
}

export async function abortMultipart(key: string, uploadId: string) {
  await s3().send(new AbortMultipartUploadCommand({ Bucket: BUCKET(), Key: key, UploadId: uploadId }));
}
