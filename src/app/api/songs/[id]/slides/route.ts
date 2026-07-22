import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { apiUser } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { songs, songSlides } from "@/lib/db/schema";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Session expired" }, { status: 401 });
  const { id } = await ctx.params;
  const db = getDb();
  const [song] = await db.select().from(songs).where(and(eq(songs.id, id), eq(songs.churchId, user.churchId))).limit(1);
  if (!song) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const slides = await db.select().from(songSlides).where(eq(songSlides.songId, song.id)).orderBy(asc(songSlides.order));
  return NextResponse.json({ title: song.title, slides: slides.map((s) => ({ id: s.id, lyrics: s.lyrics })) });
}
