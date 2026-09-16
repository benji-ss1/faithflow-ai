import { NextResponse } from "next/server";
import { apiUser } from "@/lib/session";
import { isAudioMediaSupported } from "@/lib/server/media-audio-support";

export const runtime = "nodejs";

/**
 * What the media pipeline can accept right now, so the client can route files
 * BEFORE uploading (e.g. audio → "coming soon" toast until the media_kind
 * migration is applied, instead of an upload that fails at registration).
 * Auth-gated; the answer itself is not sensitive and is cached server-side.
 */
export async function GET() {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const audio = await isAudioMediaSupported();
  return NextResponse.json({ audio }, { headers: { "Cache-Control": "private, max-age=60" } });
}
