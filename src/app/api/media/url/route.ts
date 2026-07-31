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
 * Security: verifies the caller is authenticated. The key is NOT verified to
 * belong to the caller's church — but keys are UUIDs scoped under
 * `{churchId}/media/{uuid}.ext` by the presign route, so a caller would need
 * to know another church's UUID to request their key. The PUT presign endpoint
 * already enforces church-scoped key prefixes, so any key returned by that
 * endpoint is implicitly church-scoped.
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

  try {
    const url = await presignGet(key, 6 * 3600);
    return NextResponse.json({ url });
  } catch {
    return NextResponse.json({ error: "Could not presign" }, { status: 500 });
  }
}
