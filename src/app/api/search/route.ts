import { NextResponse } from "next/server";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import { apiUser } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { songs, servicePlans } from "@/lib/db/schema";
import { parseReferences } from "@/lib/bible-parser";
import { hybridSearch, publicDomainFallbackTranslationId } from "@/lib/server/bible";

export const runtime = "nodejs";

type Hit = { id: string; title: string; subtitle?: string; href: string };

export async function GET(req: Request) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams.get("q")?.trim() || "";
  const empty = { songs: [] as Hit[], bible: [] as Hit[], services: [] as Hit[], archive: [] as Hit[] };
  if (q.length < 2) return NextResponse.json(empty);

  const db = getDb();
  const pattern = `%${q}%`;
  const result: { songs: Hit[]; bible: Hit[]; services: Hit[]; archive: Hit[] } = {
    songs: [], bible: [], services: [], archive: [],
  };

  // Songs — church-scoped, title or artist match
  const songRows = await db
    .select({ id: songs.id, title: songs.title, artist: songs.artist })
    .from(songs)
    .where(and(eq(songs.churchId, user.churchId), or(ilike(songs.title, pattern), ilike(songs.artist, pattern))))
    .limit(6);
  result.songs = songRows.map((r) => ({
    id: r.id,
    title: r.title,
    subtitle: r.artist ?? undefined,
    href: `/library/songs/${r.id}`,
  }));

  // Services — church-scoped title match
  const planRows = await db
    .select({ id: servicePlans.id, title: servicePlans.title, scheduledFor: servicePlans.scheduledFor })
    .from(servicePlans)
    .where(and(eq(servicePlans.churchId, user.churchId), ilike(servicePlans.title, pattern)))
    .limit(6);
  result.services = planRows.map((r) => ({
    id: r.id,
    title: r.title,
    subtitle: r.scheduledFor ? String(r.scheduledFor) : undefined,
    href: `/services/${r.id}`,
  }));

  // Archive — sermon summaries, church-scoped via join
  try {
    const sermonRows = (
      await db.execute(sql`
        SELECT ss.id, ss.title, ss.overview
        FROM sermon_summaries ss
        JOIN service_plans sp ON sp.id = ss.service_plan_id
        WHERE sp.church_id = ${user.churchId}
          AND (LOWER(ss.title) LIKE LOWER(${pattern}) OR LOWER(ss.overview) LIKE LOWER(${pattern}))
        LIMIT 6
      `)
    ).rows as { id: string; title: string; overview: string | null }[];
    result.archive = sermonRows.map((r) => ({
      id: r.id,
      title: r.title,
      subtitle: r.overview ? r.overview.slice(0, 90) : undefined,
      href: `/archive/${r.id}`,
    }));
  } catch {
    // sermon_summaries may not be seeded — ignore
  }

  // Bible — structured reference parse first
  const refs = parseReferences(q);
  const bibleHits: Hit[] = [];
  for (const ref of refs.slice(0, 3)) {
    const range = ref.verseStart === ref.verseEnd ? `${ref.verseStart}` : `${ref.verseStart}-${ref.verseEnd}`;
    bibleHits.push({
      id: `ref-${ref.book}-${ref.chapter}-${ref.verseStart}`,
      title: `${ref.book} ${ref.chapter}:${range}`,
      subtitle: "Open reference",
      href: `/library/bible?book=${encodeURIComponent(ref.book)}&chapter=${ref.chapter}&verse=${ref.verseStart}`,
    });
  }
  // Words → verse. Was a KJV-only ILIKE (limit 4), which returned NOTHING for
  // a remembered phrase whose wording differs from the KJV ("love is patient"
  // — KJV reads "charity suffereth long") while songs still matched, so the
  // whole surface looked song-only. Now the same hybrid engine BibleMode uses:
  // FTS (KJV + WEB, classic + modern wording) ⊕ pgvector paraphrase recall,
  // RRF-fused. Public-domain translation only — no licensed text is searched
  // or returned; ≥3 chars, matching /api/bible/search's floor and pgvector cost.
  // Only when the query ISN'T a structured reference: "John 3:16" already has
  // its exact answer, and padding it with semantic near-misses (John 1:6,
  // Mark 8:34…) would be noise the old ILIKE never produced.
  if (bibleHits.length === 0 && q.length >= 3) {
    try {
      const remaining = 4 - bibleHits.length;
      const pdId = await publicDomainFallbackTranslationId();
      const verseRows = pdId ? await hybridSearch(pdId, q, remaining) : [];
      for (const r of verseRows) {
        bibleHits.push({
          id: `v-${r.book}-${r.chapter}-${r.verse}`,
          title: `${r.book} ${r.chapter}:${r.verse}`,
          subtitle: r.text.slice(0, 100),
          href: `/library/bible?book=${encodeURIComponent(r.book)}&chapter=${r.chapter}&verse=${r.verse}`,
        });
      }
    } catch {
      // ignore missing bible tables
    }
  }
  result.bible = bibleHits;

  return NextResponse.json(result);
}
