// Session-scoped in-memory cache for Bible phrase (semantic) search results.
// Same pattern as bible-client-cache.ts's verse-lookup cache: keeps UI
// renders instant for repeat/refined searches (an operator re-running or
// slightly tweaking the same phrase mid-service shouldn't always pay the
// full embedding round trip to /api/bible/search).
//
// No persistence: keeps the cache small and avoids stale-translation issues.

export type BibleSearchHit = { book: string; chapter: number; verse: number; text: string };

type Entry = { hits: BibleSearchHit[]; translation: string; ts: number };
const cache = new Map<string, Entry>();
const CAP = 100;

export function bibleSearchCacheKey(translationCode: string, query: string, limit: number): string {
  return `${translationCode.toUpperCase()}:${limit}:${query.trim().toLowerCase()}`;
}

export function getBibleSearchCached(key: string): Entry | null {
  return cache.get(key) || null;
}

export function setBibleSearchCached(key: string, hits: BibleSearchHit[], translation: string): void {
  if (cache.size >= CAP) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { hits, translation, ts: Date.now() });
}

/** Test helper. */
export function _clearBibleSearchCache(): void { cache.clear(); }
export function _bibleSearchCacheSize(): number { return cache.size; }
