import { NextResponse } from "next/server";

/**
 * Public health probe.
 *
 * `buildId` (2026-09-22) is the deploy's commit SHA. It exists for the Electron
 * offline cache: that cache must be keyed and promoted ATOMICALLY PER BUILD,
 * because mixing a document from one Next.js build with `/_next/*` chunks from
 * another is the classic ChunkLoadError / hydration-mismatch white screen. A
 * white screen at 8:45am is strictly worse than the honest "reconnecting"
 * splash it would replace, so the cache needs a cheap, unauthenticated way to
 * ask "which build am I looking at?" before it commits a generation to disk.
 *
 * `offlineCache` is the REMOTE KILL-SWITCH for that cache. The 2026-08-11
 * service-worker incident was only survivable because `sw.js` was fetched from
 * the network and could therefore be replaced without shipping a DMG. An
 * Electron-side cache has no such property unless we build one in — so it asks
 * here, and a bad cache can be turned off for every church without a release.
 * Defaults to OFF: the cache must be switched on deliberately.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    ts: Date.now(),
    buildId: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    offlineCache: process.env.OFFLINE_CACHE_ENABLED === "1",
  });
}
