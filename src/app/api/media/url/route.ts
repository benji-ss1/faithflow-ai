import { NextResponse } from "next/server";
import { apiUser } from "@/lib/session";
import { presignGet } from "@/lib/s3";

/**
 * POST /api/media/url
 * Body: { key: string }
 * Returns: { url: string } — a 6-hour presigned GET URL for the given S3 key.
 *
 * Used by BgAssetPicker (in ThemesManager) after a presign-PUT upload to get
 * a persistent URL to store in the theme config. Blob URLs (URL.createObjectURL)
 * die on page reload — this endpoint returns a URL that survives the session.
 *
 * Security: authenticated AND church-scoped — the key's first path segment must
 * equal the caller's churchId, so a user can never presign another church's
 * media even if they learn its key. Keys are `{churchId}/{purpose}/{uuid}.{ext}`.
 */
export async function POST(req: Request) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Session expired" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { key?: unknown };
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });

  // Basic key shape guard: must look like a UUID-based S3 key, not an
  // arbitrary path traversal. Keys from the presign endpoint are always
  // `{churchId}/{purpose}/{uuid}.{ext}` — three slash-separated segments.
  const parts = key.split("/");
  if (parts.length < 3 || parts.some((p) => p === ".." || p === "." || p === "")) {
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  }
  // Church scoping: the key MUST belong to the caller's church (IDOR guard).
  if (parts[0] !== user.churchId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const url = await presignGet(key, 6 * 3600);
    return NextResponse.json({ url });
  } catch {
    return NextResponse.json({ error: "Could not presign" }, { status: 500 });
  }
}
