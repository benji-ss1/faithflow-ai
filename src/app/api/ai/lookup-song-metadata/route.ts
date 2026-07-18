// POST /api/ai/lookup-song-metadata
//
// ⚠️ Returns SONG TITLE / ARTIST METADATA ONLY. This route MUST NOT expose
// any words, snippets, or excerpts of songs. See internet-metadata.ts for
// the enforcement at the source layer.

import { NextResponse } from "next/server";
import { apiUser } from "@/lib/session";
import { getEntitlement, canUseAI } from "@/lib/server/entitlement";
import { lookupSongMetadata } from "@/lib/ai-detection/internet-metadata";

export const runtime = "nodejs";

const RATE_LIMIT = 20; // req/user/min
const WINDOW_MS = 60_000;
const counters = new Map<string, { count: number; windowStart: number }>();

function checkRate(userId: string): boolean {
  const now = Date.now();
  const entry = counters.get(userId);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    counters.set(userId, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count += 1;
  return true;
}

export async function POST(req: Request) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ent = await getEntitlement(user.churchId);
  if (!canUseAI(ent)) {
    return NextResponse.json({ error: "Song lookup requires an active subscription" }, { status: 402 });
  }

  if (!checkRate(user.id)) {
    return NextResponse.json({ error: "Rate limit exceeded (20/min)" }, { status: 429 });
  }

  let body: { title?: unknown; artist?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const artist = typeof body.artist === "string" ? body.artist.trim() : undefined;
  if (title.length < 3 || title.length > 120) {
    return NextResponse.json({ error: "title must be 3-120 chars" }, { status: 400 });
  }
  if (artist !== undefined && artist.length > 80) {
    return NextResponse.json({ error: "artist must be ≤ 80 chars" }, { status: 400 });
  }

  const result = await lookupSongMetadata(title, artist);
  if (!result) {
    return NextResponse.json({
      match: null,
      note: "No metadata match found (title/artist only lookup — no lyrics ever returned).",
    });
  }
  // Sanitize outbound shape — belt-and-brace: whitelist known keys, never lyrics.
  return NextResponse.json({
    match: {
      title: result.title,
      artist: result.artist,
      source: result.source,
      externalId: result.externalId,
      confidence: result.confidence,
      url: result.url,
      degraded: !!result.degraded,
    },
    note: result.degraded
      ? "Internet lookup unavailable — degraded stub returned (no lyrics ever returned)."
      : "Title/artist metadata only — no lyrics returned.",
  });
}
