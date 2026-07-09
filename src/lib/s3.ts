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

export async function deleteObject(key: string) {
  await s3().send(new DeleteObjectCommand({ Bucket: BUCKET(), Key: key }));
}

export async function putBuffer(key: string, body: Buffer, contentType: string) {
  await s3().send(new PutObjectCommand({ Bucket: BUCKET(), Key: key, Body: body, ContentType: contentType }));
}
