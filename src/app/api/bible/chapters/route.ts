import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { apiUser } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { listTranslations } from "@/lib/server/bible";

export const runtime = "nodejs";

/**
 * GET /api/bible/chapters?book=John&translation=KJV
 * Returns { chapters: [{ chapter, verseCount }] } for the given book.
 * The DB doesn't store chapter/verse counts explicitly — derive with a
 * grouped query. One roundtrip per (book, translation).
 */
export async function GET(req: Request) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const book = url.searchParams.get("book");
  const code = url.searchParams.get("translation") || "KJV";
  if (!book) return NextResponse.json({ error: "book required" }, { status: 400 });

  const translations = await listTranslations();
  const t = translations.find((x) => x.code.toUpperCase() === code.toUpperCase())
        || translations.find((x) => !x.licenseRequired)
        || translations[0];
  if (!t) return NextResponse.json({ chapters: [] });
  if (t.licenseRequired) return NextResponse.json({ chapters: [] });

  const db = getDb();
  const rows = (await db.execute(sql`
    SELECT chapter, COUNT(verse)::int AS "verseCount"
    FROM bible_verses
    WHERE translation_id = ${t.id} AND LOWER(book) = LOWER(${book})
    GROUP BY chapter
    ORDER BY chapter
  `)).rows as { chapter: number; verseCount: number }[];
  return NextResponse.json({ chapters: rows });
}
