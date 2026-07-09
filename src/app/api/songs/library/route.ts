// Local song library endpoint for the AI-detection client-side matcher.
//
// ⚠️ Returns ONLY songs that already have lyrics stored locally. No web
// fetching happens here. Public-domain and church/imported are all
// pre-verified data owned by the church.

import { NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { apiUser } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { songs, songSlides } from "@/lib/db/schema";

export const runtime = "nodejs";

export async function GET() {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();

  // Church-owned + imported + public-domain hymns (public-domain rows are
  // scoped per-church at import time in this schema).
  const rows = await db.select().from(songs).where(eq(songs.churchId, user.churchId));
  if (rows.length === 0) return NextResponse.json({ songs: [] });

  const slides = await db.select().from(songSlides)
    .where(inArray(songSlides.songId, rows.map((r) => r.id)))
    .orderBy(asc(songSlides.order));
  const bySong = new Map<string, { order: number; lyrics: string }[]>();
  for (const s of slides) {
    const list = bySong.get(s.songId) || [];
    list.push({ order: s.order, lyrics: s.lyrics });
    bySong.set(s.songId, list);
  }

  const out = rows
    .map((r) => ({
      songId: r.id,
      title: r.title,
      artist: r.artist,
      source: r.source,
      slides: (bySong.get(r.id) || []).filter((s) => s.lyrics && s.lyrics.trim().length > 0),
    }))
    // SAFETY: never expose a song with no lyric slides — the matcher would
    // reject it anyway, but we belt-and-brace here.
    .filter((s) => s.slides.length > 0);

  return NextResponse.json({ songs: out });
}
