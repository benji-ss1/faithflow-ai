import { NextResponse } from "next/server";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import { apiUser } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { songs, servicePlans, sermonSummaries } from "@/lib/db/schema";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams.get("q")?.trim() || "";
  if (q.length < 2) return NextResponse.json({ hits: [] });

  const db = getDb();
  const pattern = `%${q}%`;
  const hits: { kind: string; title: string; subtitle?: string; href: string }[] = [];

  // Songs — scoped by church
  const songRows = await db.select({ id: songs.id, title: songs.title, artist: songs.artist })
    .from(songs)
    .where(and(eq(songs.churchId, user.churchId), ilike(songs.title, pattern)))
    .limit(6);
  for (const r of songRows) hits.push({ kind: "song", title: r.title, subtitle: r.artist ?? undefined, href: `/library/songs/${r.id}` });

  // Service plans — scoped
  const planRows = await db.select({ id: servicePlans.id, title: servicePlans.title })
    .from(servicePlans)
    .where(and(eq(servicePlans.churchId, user.churchId), ilike(servicePlans.title, pattern)))
    .limit(4);
  for (const r of planRows) hits.push({ kind: "plan", title: r.title, href: `/services/${r.id}` });

  // Sermon summaries — scoped via join
  const sermonRows = (await db.execute(sql`
    SELECT ss.id, ss.title, ss.overview
    FROM sermon_summaries ss
    JOIN service_plans sp ON sp.id = ss.service_plan_id
    WHERE sp.church_id = ${user.churchId}
      AND (LOWER(ss.title) LIKE LOWER(${pattern}) OR LOWER(ss.overview) LIKE LOWER(${pattern}))
    LIMIT 4
  `)).rows as { id: string; title: string; overview: string }[];
  for (const r of sermonRows) hits.push({ kind: "sermon", title: r.title, subtitle: r.overview.slice(0, 80), href: `/archive/${r.id}` });

  // Bible verses — cross-translation search, KJV only for speed. Returns
  // exact-phrase hits. Not scoped by church (Bible is shared).
  const verseRows = (await db.execute(sql`
    SELECT bv.book, bv.chapter, bv.verse, bv.text, t.code AS translation_code
    FROM bible_verses bv
    JOIN bible_translations t ON t.id = bv.translation_id
    WHERE t.code = 'KJV' AND bv.text ILIKE ${pattern}
    LIMIT 4
  `)).rows as { book: string; chapter: number; verse: number; text: string; translation_code: string }[];
  for (const r of verseRows) hits.push({
    kind: "verse",
    title: `${r.book} ${r.chapter}:${r.verse}`,
    subtitle: r.text.slice(0, 100),
    href: `/library/bible?book=${encodeURIComponent(r.book)}&chapter=${r.chapter}`,
  });

  return NextResponse.json({ hits });
}
