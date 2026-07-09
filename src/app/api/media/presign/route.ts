import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { apiUser } from "@/lib/session";
import { presignPut } from "@/lib/s3";

const ALLOWED_IMAGE = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ALLOWED_VIDEO = ["video/mp4", "video/webm", "video/quicktime"];
const ALLOWED_PPTX = ["application/vnd.openxmlformats-officedocument.presentationml.presentation"];
const MAX_SIZE = 500 * 1024 * 1024;

export async function POST(req: Request) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Session expired — please sign in again" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { fileName, contentType, size, purpose } = body as { fileName?: string; contentType?: string; size?: number; purpose?: string };
  if (!fileName || !contentType || typeof size !== "number") return NextResponse.json({ error: "Bad request" }, { status: 400 });
  if (size > MAX_SIZE) return NextResponse.json({ error: "File too large" }, { status: 400 });

  const allowed = purpose === "pptx" ? ALLOWED_PPTX : [...ALLOWED_IMAGE, ...ALLOWED_VIDEO];
  if (!allowed.includes(contentType)) return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });

  const ext = fileName.split(".").pop() || "bin";
  const key = `${user.churchId}/${purpose || "media"}/${randomUUID()}.${ext}`;
  const url = await presignPut(key, contentType);
  return NextResponse.json({ url, key });
}
