// Session-scoped in-memory cache for Bible lookups, plus a POST wrapper that
// checks the cache first. Keeps UI renders instant for repeat references
// (common during a service — same verse quoted multiple times).
//
// No persistence: keeps the cache small and avoids stale-translation issues.

export type BibleVerse = { verse: number; text: string; chapter?: number; book?: string };

type Entry = { verses: BibleVerse[]; translation: string; ts: number };
const cache = new Map<string, Entry>();
const CAP = 500;

export function bibleCacheKey(translationCode: string, book: string, chapter: number, verseStart: number, verseEnd: number, chapterEnd?: number): string {
  return `${translationCode.toUpperCase()}:${book.toLowerCase()}:${chapter}:${verseStart}-${verseEnd}${chapterEnd && chapterEnd !== chapter ? `:${chapterEnd}` : ""}`;
}

export function getBibleCached(key: string): Entry | null {
  return cache.get(key) || null;
}

export function setBibleCached(key: string, verses: BibleVerse[], translation: string): void {
  if (cache.size >= CAP) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { verses, translation, ts: Date.now() });
}

export type LookupInput = {
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
  chapterEnd?: number;
  translationCode: string;
};

export type LookupResult = { verses: BibleVerse[]; translation: string; cached: boolean };

/**
 * Cached wrapper for POST /api/bible/lookup. Returns cached entry synchronously-
 * ish (still async for API compat) when present.
 */
export async function cachedLookup(p: LookupInput): Promise<LookupResult> {
  const key = bibleCacheKey(p.translationCode, p.book, p.chapter, p.verseStart, p.verseEnd, p.chapterEnd);
  const hit = getBibleCached(key);
  if (hit) return { verses: hit.verses, translation: hit.translation, cached: true };
  const res = await fetch("/api/bible/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(p),
  }).then((r) => r.json());
  if (res.error) throw new Error(res.error);
  const verses: BibleVerse[] = res.verses || [];
  const translation: string = res.translation || p.translationCode;
  if (verses.length > 0) setBibleCached(key, verses, translation);
  return { verses, translation, cached: !!res.cached };
}

/** Test helper. */
export function _clearBibleClientCache(): void { cache.clear(); }
export function _bibleClientCacheSize(): number { return cache.size; }
