// Server-only. Do not import from client components. (Not using the
// `server-only` package because this module is also used from stand-alone
// Node scripts — audio-server, prune, embed — where the package throws.)
import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { bibleTranslations, bibleVerses, licensedTranslations } from "../db/schema";
import { embed, toVectorLiteral } from "../embeddings";
import { fetchApiBibleVerses, decryptApiKey, API_BIBLE_TRANSLATIONS } from "./api-bible";

/**
 * Global (platform-wide) API.Bible key. Optional. When set, every church gets
 * the supported licensed translations (NIV/NKJV/NLT) with no per-church setup —
 * a church's OWN key (licensed_translations row) always takes precedence over
 * this. Read lazily so a missing env var never throws at import time. All calls
 * share this one key's quota, so keep an eye on the API.Bible dashboard.
 */
export function getGlobalApiBibleKey(): string | null {
  const k = process.env.API_BIBLE_KEY?.trim();
  return k && k.length >= 8 ? k : null;
}

/** Map a display code (e.g. "NIV") → the verified provider Bible ID, or null. */
function globalBibleIdForCode(code: string): string | null {
  const t = API_BIBLE_TRANSLATIONS.find((x) => x.code.toUpperCase() === code.toUpperCase());
  return t?.bibleId ?? null;
}

/**
 * Which licensed codes are available to a church RIGHT NOW — via the church's
 * own active key, plus (if a platform key is configured) the globally-supported
 * set. Used by the translations API so the picker + voice switcher only offer
 * codes that will actually resolve. Returns UPPERCASE codes.
 */
export async function availableLicensedCodes(churchId: string): Promise<Set<string>> {
  const out = new Set<string>();
  const db = getDb();
  const rows = await db
    .select({ displayCode: licensedTranslations.displayCode, active: licensedTranslations.active })
    .from(licensedTranslations)
    .where(eq(licensedTranslations.churchId, churchId));
  for (const r of rows) if (r.active) out.add(r.displayCode.toUpperCase());
  if (getGlobalApiBibleKey()) {
    for (const t of API_BIBLE_TRANSLATIONS) out.add(t.code.toUpperCase());
  }
  return out;
}

export type Translation = { id: string; code: string; name: string; isPublicDomain: boolean; licenseRequired: boolean };
export type Verse = { id: string; book: string; bookOrder: number; chapter: number; verse: number; text: string };

// Both tables below change essentially never within an operator's service
// (translations are seeded once, licensing flags don't flip mid-service),
// but were previously re-queried on every single verse lookup — "Next
// verse" did 3 sequential DB round trips per click (translations list,
// license check, verse select). A short in-process TTL cache turns the
// first two into a single query every few minutes instead of every click.
const CACHE_TTL_MS = 5 * 60 * 1000;
let translationsCache: { at: number; value: Translation[] } | null = null;
const licenseCache = new Map<string, { at: number; value: boolean }>();

/**
 * Server-side invariant: any read that returns verse text must be gated on
 * this check. Licensed translations (NIV/ESV/NKJV) MUST NOT return content
 * through any code path — they have no verses stored, but we hard-guard
 * anyway to prevent accidental future leakage.
 */
async function isLicensedTranslation(translationId: string): Promise<boolean> {
  const cached = licenseCache.get(translationId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  const db = getDb();
  const [row] = await db.select({ licenseRequired: bibleTranslations.licenseRequired })
    .from(bibleTranslations).where(eq(bibleTranslations.id, translationId)).limit(1);
  const value = !!row?.licenseRequired;
  licenseCache.set(translationId, { at: Date.now(), value });
  return value;
}

// Fetches the active licensedTranslations row for a given church + translationCode.
// Used by lookupReference to decide whether to fall back to API.Bible.
// Result is cached per (churchId, code) for CACHE_TTL_MS.
const licensedRowCache = new Map<string, { at: number; value: { providerBibleId: string; apiKeyEncrypted: string | null } | null }>();

async function getLicensedRow(
  churchId: string,
  translationCode: string,
): Promise<{ providerBibleId: string; apiKeyEncrypted: string | null } | null> {
  const ck = `${churchId}|${translationCode}`;
  const cached = licensedRowCache.get(ck);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  const db = getDb();
  const [row] = await db
    .select({ providerBibleId: licensedTranslations.providerBibleId, apiKeyEncrypted: licensedTranslations.apiKeyEncrypted })
    .from(licensedTranslations)
    .where(
      and(
        eq(licensedTranslations.churchId, churchId),
        eq(licensedTranslations.displayCode, translationCode),
        eq(licensedTranslations.active, true),
      ),
    )
    .limit(1);
  const value = row ?? null;
  licensedRowCache.set(ck, { at: Date.now(), value });
  return value;
}

/** Invalidate the licensed-row cache for a church (call after saving API key). */
export function invalidateLicensedCache(churchId: string): void {
  for (const key of licensedRowCache.keys()) {
    if (key.startsWith(`${churchId}|`)) licensedRowCache.delete(key);
  }
  // Also bust the translations list cache so newly-activated rows surface.
  translationsCache = null;
}

export async function listTranslations(): Promise<Translation[]> {
  if (translationsCache && Date.now() - translationsCache.at < CACHE_TTL_MS) return translationsCache.value;
  const db = getDb();
  const rows = await db.select().from(bibleTranslations).orderBy(asc(bibleTranslations.code));
  const value = rows.map((r) => ({ id: r.id, code: r.code, name: r.name, isPublicDomain: r.isPublicDomain, licenseRequired: r.licenseRequired }));
  translationsCache = { at: Date.now(), value };
  return value;
}

export async function listBooks(translationId: string): Promise<{ book: string; bookOrder: number; chapters: number }[]> {
  if (await isLicensedTranslation(translationId)) return [];
  const db = getDb();
  const rows = (await db.execute(sql`
    SELECT book, book_order AS "bookOrder", MAX(chapter) AS chapters
    FROM bible_verses WHERE translation_id = ${translationId}
    GROUP BY book, book_order ORDER BY book_order
  `)).rows as { book: string; bookOrder: number; chapters: number }[];
  return rows;
}

export async function getChapter(translationId: string, book: string, chapter: number): Promise<Verse[]> {
  if (await isLicensedTranslation(translationId)) return [];
  const db = getDb();
  const rows = await db.select().from(bibleVerses).where(
    and(eq(bibleVerses.translationId, translationId), eq(bibleVerses.book, book), eq(bibleVerses.chapter, chapter))
  ).orderBy(asc(bibleVerses.verse));
  return rows.map((r) => ({ id: r.id, book: r.book, bookOrder: r.bookOrder, chapter: r.chapter, verse: r.verse, text: r.text }));
}

export type FullTranslationChapter = { book: string; chapter: number; verses: { verse: number; text: string }[] };
export type FullTranslation = { code: string; name: string; chapters: FullTranslationChapter[] };

/**
 * Whole-translation dump for OFFLINE hydration. PUBLIC-DOMAIN ONLY — returns
 * null for licensed or unknown codes so a bulk request can never hit API.Bible
 * (the shared 5k/month quota would be destroyed by ~1,189 chapter fetches).
 * Reads local Postgres in one ordered scan and groups into chapters.
 */
export async function getFullPublicDomainTranslation(code: string): Promise<FullTranslation | null> {
  const db = getDb();
  const [t] = await db.select().from(bibleTranslations)
    .where(eq(bibleTranslations.code, code.toUpperCase())).limit(1);
  if (!t || !t.isPublicDomain || t.licenseRequired) return null;
  const rows = await db.select({
    book: bibleVerses.book, chapter: bibleVerses.chapter, verse: bibleVerses.verse, text: bibleVerses.text,
  }).from(bibleVerses)
    .where(eq(bibleVerses.translationId, t.id))
    .orderBy(asc(bibleVerses.bookOrder), asc(bibleVerses.chapter), asc(bibleVerses.verse));
  const chapters: FullTranslationChapter[] = [];
  let cur: FullTranslationChapter | null = null;
  for (const r of rows) {
    if (!cur || cur.book !== r.book || cur.chapter !== r.chapter) {
      cur = { book: r.book, chapter: r.chapter, verses: [] };
      chapters.push(cur);
    }
    cur.verses.push({ verse: r.verse, text: r.text });
  }
  return { code: t.code, name: t.name, chapters };
}

/**
 * Look up a verse range for a book. Supports cross-chapter ranges via the
 * optional `chapterEnd` param — when provided (and > `chapter`), returns
 * verses from (chapter:verseStart) through (chapterEnd:verseEnd) inclusive.
 * Single-chapter is unchanged: chapter=chapterEnd means BETWEEN verseStart..verseEnd.
 *
 * When the translation is licensed and no local verses are stored, falls back
 * to API.Bible if the church has an active licensedTranslations row with a
 * valid API key. Requires `translationCode` and `churchId` for the fallback.
 */
export async function lookupReference(
  translationId: string,
  book: string,
  chapter: number,
  verseStart: number,
  verseEnd: number,
  chapterEnd?: number,
  translationCode?: string,
  churchId?: string,
): Promise<Verse[]> {
  const isLicensed = await isLicensedTranslation(translationId);

  if (!isLicensed) {
    // Standard path: verses stored locally.
    const db = getDb();
    const chEnd = chapterEnd && chapterEnd > chapter ? chapterEnd : chapter;
    if (chEnd === chapter) {
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
    // Cross-chapter range.
    const rows = (await db.execute(sql`
      SELECT id, book, book_order AS "bookOrder", chapter, verse, text
      FROM bible_verses
      WHERE translation_id = ${translationId}
        AND LOWER(book) = LOWER(${book})
        AND (
          (chapter = ${chapter} AND verse >= ${verseStart})
          OR (chapter > ${chapter} AND chapter < ${chEnd})
          OR (chapter = ${chEnd} AND verse <= ${verseEnd})
        )
      ORDER BY chapter, verse
    `)).rows as Verse[];
    return rows;
  }

  // Licensed translation path — no verses stored locally. Resolve API.Bible
  // access: the church's OWN active key wins; otherwise fall back to the
  // platform-wide global key (getGlobalApiBibleKey) so churches that haven't
  // configured their own still get NIV/NKJV/NLT.
  if (!translationCode) return [];
  let providerBibleId: string | null = null;
  let apiKey: string | null = null;
  if (churchId) {
    const licensed = await getLicensedRow(churchId, translationCode);
    if (licensed) {
      const k = decryptApiKey(licensed.apiKeyEncrypted);
      if (k) { providerBibleId = licensed.providerBibleId; apiKey = k; }
    }
  }
  if (!apiKey) {
    const globalKey = getGlobalApiBibleKey();
    const bibleId = globalBibleIdForCode(translationCode);
    if (globalKey && bibleId) { providerBibleId = bibleId; apiKey = globalKey; }
  }
  if (!apiKey || !providerBibleId) return [];

  // For cross-chapter licensed lookups, iterate per chapter.
  const chEnd = chapterEnd && chapterEnd > chapter ? chapterEnd : chapter;
  if (chEnd === chapter) {
    return (await fetchApiBibleVerses(
      providerBibleId, apiKey, book, chapter, verseStart, verseEnd, translationId,
    )) ?? [];
  }
  // Multi-chapter: fetch each chapter's segment and concatenate.
  const segments: Verse[][] = [];
  for (let ch = chapter; ch <= chEnd; ch++) {
    const vStart = ch === chapter ? verseStart : 1;
    const vEnd = ch === chEnd ? verseEnd : 200; // 200 is a safe upper bound
    const seg = await fetchApiBibleVerses(
      providerBibleId, apiKey, book, ch, vStart, vEnd, translationId,
    );
    if (seg) segments.push(seg);
  }
  return segments.flat();
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
export async function lookupReferenceWithWindow(
  translationId: string,
  book: string,
  chapter: number,
  verseStart: number,
  verseEnd: number,
  windowSize = 5,
  translationCode?: string,
  churchId?: string,
): Promise<{ primary: Verse[]; before: Verse[]; after: Verse[] }> {
  const isLicensed = await isLicensedTranslation(translationId);

  if (!isLicensed) {
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

  // Licensed — fetch a wider window from API.Bible (single chapter only for now).
  if (!churchId || !translationCode) return { primary: [], before: [], after: [] };
  const licensed = await getLicensedRow(churchId, translationCode);
  if (!licensed) return { primary: [], before: [], after: [] };
  const apiKey = decryptApiKey(licensed.apiKeyEncrypted);
  if (!apiKey) return { primary: [], before: [], after: [] };

  const winStart = Math.max(1, verseStart - windowSize);
  const winEnd = verseEnd + windowSize;
  const rows = (await fetchApiBibleVerses(
    licensed.providerBibleId, apiKey, book, chapter, winStart, winEnd, translationId,
  )) ?? [];
  return {
    primary: rows.filter((r) => r.verse >= verseStart && r.verse <= verseEnd),
    before: rows.filter((r) => r.verse < verseStart),
    after: rows.filter((r) => r.verse > verseEnd),
  };
}

export type SearchHit = Verse & { distance: number };

export async function semanticSearch(translationId: string, query: string, limit = 20): Promise<SearchHit[]> {
  if (await isLicensedTranslation(translationId)) return [];
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

// ── Lexical (full-text) search ───────────────────────────────────────────────
// Postgres FTS over the verse text, backed by the GIN index
// idx_bible_verses_fts (to_tsvector('english', text)). This is the EXACT-quote
// arm of hybrid search: a verbatim or near-verbatim quotation ("the Lord is my
// shepherd, I shall not want") ranks its verse first, where a purely semantic
// vector search can be out-ranked by a topically-similar-but-wrong verse.
// websearch_to_tsquery tolerates ordinary phrasing (no special syntax needed).
export type LexicalHit = Verse & { rank: number };
export async function lexicalSearch(translationId: string, query: string, limit = 20): Promise<LexicalHit[]> {
  if (await isLicensedTranslation(translationId)) return []; // no local text to index
  const db = getDb();
  const rows = (await db.execute(sql`
    SELECT id, book, book_order AS "bookOrder", chapter, verse, text,
           ts_rank(to_tsvector('english', text), websearch_to_tsquery('english', ${query})) AS rank
    FROM bible_verses
    WHERE translation_id = ${translationId}
      AND to_tsvector('english', text) @@ websearch_to_tsquery('english', ${query})
    ORDER BY rank DESC
    LIMIT ${limit}
  `)).rows as LexicalHit[];
  return rows;
}

// The public-domain translation used to RESOLVE references when the requested
// translation is licensed (NIV/NKJV/NLT store no local text/embeddings, so they
// can't be searched directly). We search a fully-stored public-domain
// translation to find WHICH verses match, then the caller renders those
// references in the church's licensed translation via lookupReference/API.Bible
// — the "search ranks, DB renders canonical text" invariant. Prefers KJV
// (always present + fully embedded); falls back to any public-domain translation.
let _pdFallbackId: { at: number; id: string | null } | null = null;
export async function publicDomainFallbackTranslationId(): Promise<string | null> {
  if (_pdFallbackId && Date.now() - _pdFallbackId.at < CACHE_TTL_MS) return _pdFallbackId.id;
  const db = getDb();
  const rows = await db.select({ id: bibleTranslations.id, code: bibleTranslations.code })
    .from(bibleTranslations)
    .where(and(eq(bibleTranslations.isPublicDomain, true), eq(bibleTranslations.licenseRequired, false)));
  const kjv = rows.find((r) => r.code === "KJV");
  const id = kjv?.id ?? rows[0]?.id ?? null;
  _pdFallbackId = { at: Date.now(), id };
  return id;
}

// ── Hybrid search (lexical BM25-style FTS ⊕ semantic vector), RRF-fused ───────
// Reciprocal Rank Fusion: each engine contributes 1/(K + rank) per verse; the
// summed score ranks the merged set. K=60 is the canonical RRF constant. This
// gives exact quotations (lexical) and paraphrases/allusions (semantic) a fair
// combined ranking without hand-tuned weights. For a LICENSED translation we
// resolve references against the public-domain fallback (see above) so the
// church still gets quote→verse search even though we can't store their text.
export type HybridHit = Verse & { score: number; lexical: boolean; semantic: boolean };
export async function hybridSearch(translationId: string, query: string, limit = 20): Promise<HybridHit[]> {
  let searchId = translationId;
  if (await isLicensedTranslation(translationId)) {
    const pd = await publicDomainFallbackTranslationId();
    if (!pd) return []; // no public-domain translation to resolve against
    searchId = pd;
  }
  // Over-fetch each arm so the fusion has depth to reorder from.
  const pool = Math.min(Math.max(limit * 3, 30), 100);
  const [lex, sem] = await Promise.all([
    lexicalSearch(searchId, query, pool),
    semanticSearch(searchId, query, pool),
  ]);
  const K = 60;
  const byKey = new Map<string, HybridHit>();
  const bump = (v: Verse, rank: number, which: "lexical" | "semantic") => {
    const key = `${v.book}|${v.chapter}|${v.verse}`;
    const existing = byKey.get(key);
    const contribution = 1 / (K + rank);
    if (existing) {
      existing.score += contribution;
      existing[which] = true;
    } else {
      byKey.set(key, { ...v, score: contribution, lexical: which === "lexical", semantic: which === "semantic" });
    }
  };
  lex.forEach((v, i) => bump(v, i + 1, "lexical"));
  sem.forEach((v, i) => bump(v, i + 1, "semantic"));
  return [...byKey.values()].sort((a, b) => b.score - a.score).slice(0, limit);
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
