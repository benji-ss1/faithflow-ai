// Server-only. Do not import from client components. (Not using the
// `server-only` package because this module is also used from stand-alone
// Node scripts — audio-server, prune, embed — where the package throws.)
import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { bibleTranslations, bibleVerses } from "../db/schema";
import { embed, toVectorLiteral } from "../embeddings";

export type Translation = { id: string; code: string; name: string; isPublicDomain: boolean };
export type Verse = { id: string; book: string; bookOrder: number; chapter: number; verse: number; text: string };

export async function listTranslations(): Promise<Translation[]> {
  const db = getDb();
  const rows = await db.select().from(bibleTranslations).orderBy(asc(bibleTranslations.code));
  return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, isPublicDomain: r.isPublicDomain }));
}

export async function listBooks(translationId: string): Promise<{ book: string; bookOrder: number; chapters: number }[]> {
  const db = getDb();
  const rows = (await db.execute(sql`
    SELECT book, book_order AS "bookOrder", MAX(chapter) AS chapters
    FROM bible_verses WHERE translation_id = ${translationId}
    GROUP BY book, book_order ORDER BY book_order
  `)).rows as { book: string; bookOrder: number; chapters: number }[];
  return rows;
}

export async function getChapter(translationId: string, book: string, chapter: number): Promise<Verse[]> {
  const db = getDb();
  const rows = await db.select().from(bibleVerses).where(
    and(eq(bibleVerses.translationId, translationId), eq(bibleVerses.book, book), eq(bibleVerses.chapter, chapter))
  ).orderBy(asc(bibleVerses.verse));
  return rows.map((r) => ({ id: r.id, book: r.book, bookOrder: r.bookOrder, chapter: r.chapter, verse: r.verse, text: r.text }));
}

export async function lookupReference(translationId: string, book: string, chapter: number, verseStart: number, verseEnd: number): Promise<Verse[]> {
  const db = getDb();
  const rows = (await db.execute(sql`
    SELECT id, book, book_order AS "bookOrder", chapter, verse, text
    FROM bible_verses
    WHERE translation_id = ${translationId}
      AND LOWER(book) = LOWER(${book})
      AND chapter = ${chapter}
      AND verse BETWEEN ${verseStart} AND ${verseEnd}
    ORDER BY verse
  `)).rows as Verse[];
  return rows;
}

/**
 * Fetch a ±windowSize verse window around a reference. Used to preload
 * "next verse / previous / continue" targets so the operator doesn't
 * wait on a DB roundtrip mid-service.
 *
 * Returns the primary verses first (the actual reference), then the
 * surrounding window. Handles chapter boundaries: if verseStart-windowSize
 * < 1 or verseEnd+windowSize > max chapter verse, it returns what exists.
 */
export async function lookupReferenceWithWindow(translationId: string, book: string, chapter: number, verseStart: number, verseEnd: number, windowSize = 5): Promise<{ primary: Verse[]; before: Verse[]; after: Verse[] }> {
  const db = getDb();
  const winStart = Math.max(1, verseStart - windowSize);
  const winEnd = verseEnd + windowSize;
  const rows = (await db.execute(sql`
    SELECT id, book, book_order AS "bookOrder", chapter, verse, text
    FROM bible_verses
    WHERE translation_id = ${translationId}
      AND LOWER(book) = LOWER(${book})
      AND chapter = ${chapter}
      AND verse BETWEEN ${winStart} AND ${winEnd}
    ORDER BY verse
  `)).rows as Verse[];
  return {
    primary: rows.filter((r) => r.verse >= verseStart && r.verse <= verseEnd),
    before: rows.filter((r) => r.verse < verseStart),
    after: rows.filter((r) => r.verse > verseEnd),
  };
}

export type SearchHit = Verse & { distance: number };

export async function semanticSearch(translationId: string, query: string, limit = 20): Promise<SearchHit[]> {
  const db = getDb();
  const vec = await embed(query);
  const lit = toVectorLiteral(vec);
  // Cosine distance (`<=>` operator in pgvector). Lower = more similar.
  const rows = (await db.execute(sql`
    SELECT id, book, book_order AS "bookOrder", chapter, verse, text,
           (embedding <=> ${lit}::vector) AS distance
    FROM bible_verses
    WHERE translation_id = ${translationId} AND embedding IS NOT NULL
    ORDER BY embedding <=> ${lit}::vector
    LIMIT ${limit}
  `)).rows as SearchHit[];
  return rows;
}

export async function embeddedVerseCount(translationId: string): Promise<{ done: number; total: number }> {
  const db = getDb();
  const [row] = (await db.execute(sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(embedding)::int AS done
    FROM bible_verses WHERE translation_id = ${translationId}
  `)).rows as { done: number; total: number }[];
  return { done: row?.done || 0, total: row?.total || 0 };
}
