import { NextResponse } from "next/server";
import { apiUser } from "@/lib/session";
import { S3Client, HeadBucketCommand } from "@aws-sdk/client-s3";

export const runtime = "nodejs";

/**
 * Auth-gated. Returns only a boolean on failure — the real AWS SDK error
 * (which contains bucket name / endpoint / region) is logged server-side.
 * Bucket name is NEVER echoed on the failure path to keep infra silent.
 */
export async function GET() {
  const user = await apiUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    console.error("[health/storage] S3_BUCKET not set");
    return NextResponse.json({ ok: false, error: "Storage misconfigured" }, { status: 500 });
  }

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
    return NextResponse.json({ ok: true, ts: Date.now() });
  } catch (e) {
    console.error("[health/storage]", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: false, error: "Storage unreachable" }, { status: 500 });
  }
}
