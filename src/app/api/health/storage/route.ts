import { NextResponse } from "next/server";
import { S3Client, HeadBucketCommand } from "@aws-sdk/client-s3";

export const runtime = "nodejs";

export async function GET() {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) return NextResponse.json({ ok: false, error: "S3_BUCKET not set" }, { status: 500 });

  try {
    const client = new S3Client({
      region: process.env.AWS_REGION || "us-east-1",
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: !!process.env.S3_ENDPOINT,
      credentials: (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
        ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY }
        : undefined,
    });
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return NextResponse.json({ ok: true, bucket, ts: Date.now() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "unknown" }, { status: 500 });
  }
}
