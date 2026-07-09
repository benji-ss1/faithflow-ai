import { NextResponse } from "next/server";
import { apiUser } from "@/lib/session";
import { listMedia } from "@/lib/server/services";
import { presignGet } from "@/lib/s3";

export const runtime = "nodejs";

export async function GET() {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const media = await listMedia(user.churchId);
  const withUrls = await Promise.all(media.map(async (m) => ({
    id: m.id,
    fileName: m.fileName,
    kind: m.kind,
    sizeBytes: m.sizeBytes,
    createdAt: m.createdAt.toISOString(),
    url: await presignGet(m.s3Key),
  })));
  return NextResponse.json({ assets: withUrls });
}
