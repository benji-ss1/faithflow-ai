import { NextResponse } from "next/server";
import { apiUser } from "@/lib/session";
import { createLimiter } from "@/lib/rate-limit";
import { listMedia } from "@/lib/server/services";
import { presignGet } from "@/lib/s3";

export const runtime = "nodejs";

// 30/min is generous for interactive library browsing but blocks a script
// that mints fresh 6h-TTL presigned URLs on every call to outlive a session
// downgrade / tier expiry.
const mediaListLimiter = createLimiter("media-list", 30, 60_000);

// A named library id must be a UUID (Y2) — reject anything else with a 400 so a
// malformed/hostile ?library= can never reach the query as an opaque string.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await mediaListLimiter(user.id))) {
    return NextResponse.json({ error: "Too many media list requests — slow down" }, { status: 429 });
  }
  // ProPresenter parity: ?library=all (default) | default (unfiled) | <uuid>.
  const lib = new URL(req.url).searchParams.get("library");
  if (lib != null && lib !== "all" && lib !== "default" && !UUID_RE.test(lib)) {
    return NextResponse.json({ error: "Invalid library id" }, { status: 400 });
  }
  const filter = lib == null || lib === "all" ? undefined : lib === "default" ? null : lib;
  // ?audio=1 — only the operator Media Bin opts in to audio tiles (see listMedia).
  const includeAudio = new URL(req.url).searchParams.get("audio") === "1";
  const media = await listMedia(user.churchId, filter, { includeAudio });
  const withUrls = await Promise.all(media.map(async (m) => {
    // `url` is the full-res original — used for PROJECTION (must stay high-res).
    // `thumbUrl` is the small grid preview (falls back to the original when no
    // thumbnail has been generated yet, e.g. pre-backfill or a video). The grid
    // renders thumbUrl; projection uses url. presignGet is a local HMAC (cheap),
    // so signing both per asset is negligible.
    const [url, thumbUrl] = await Promise.all([
      presignGet(m.s3Key),
      presignGet(m.thumbS3Key ?? m.s3Key),
    ]);
    return {
      id: m.id,
      fileName: m.fileName,
      kind: m.kind,
      sizeBytes: m.sizeBytes,
      durationMs: m.durationMs ?? null,
      createdAt: m.createdAt.toISOString(),
      url,
      thumbUrl,
      // The durable S3 key (NOT a presigned URL) so a media-set Background
      // Template can re-mint a fresh URL across restarts (useBackgroundState).
      // Church-scoped keys; the /api/media/url re-mint endpoint re-checks the
      // caller's churchId against the key's first segment (IDOR guard).
      mediaKey: m.s3Key,
      // Watched folders: where this file came from, relative to the watched
      // folder. The reconcile identity — the sync diffs on this, not on the
      // display name (which the operator may rename in-app).
      sourceRelPath: m.sourceRelPath ?? null,
    };
  }));
  return NextResponse.json({ assets: withUrls });
}
