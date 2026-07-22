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
  // Distinguishes AI auto-detection calls (frequent, small, automatic) from
  // deliberate manual "Lookup" clicks so the server can budget them under
  // separate rate limits — see src/app/api/bible/lookup/route.ts.
  source?: "manual" | "ai";
};

export type LookupResult = { verses: BibleVerse[]; translation: string; cached: boolean };

async function rawLookup(p: LookupInput, timeoutMs: number): Promise<{ error?: string; verses?: BibleVerse[]; translation?: string; cached?: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch("/api/bible/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
      signal: controller.signal,
    }).then((r) => r.json());
  } finally {
    clearTimeout(timer);
  }
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === "AbortError" || /aborted/i.test(e.message));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Cached wrapper for POST /api/bible/lookup. Returns cached entry synchronously-
 * ish (still async for API compat) when present.
 *
 * One automatic retry on either a network abort (longer timeout — cold-instance
 * DB queries can legitimately take a few seconds) OR a 429 from the rate
 * limiter (short backoff — a transient burst of AI detections briefly tripping
 * the per-minute budget shouldn't surface as a dead-end error; a real 429
 * clears within a second). Previously only AbortError retried, so a 429
 * response — which resolves normally, just with res.error set — threw
 * immediately with no retry at all. Still only ONE retry either way, then a
 * clean user-facing message — this must not mask a genuinely broken backend.
 */
export async function cachedLookup(p: LookupInput): Promise<LookupResult> {
  const key = bibleCacheKey(p.translationCode, p.book, p.chapter, p.verseStart, p.verseEnd, p.chapterEnd);
  const hit = getBibleCached(key);
  if (hit) return { verses: hit.verses, translation: hit.translation, cached: true };
  let res: { error?: string; verses?: BibleVerse[]; translation?: string; cached?: boolean };
  try {
    res = await rawLookup(p, 5000);
  } catch (e) {
    if (!isAbortError(e)) throw new Error(e instanceof Error ? e.message : "Lookup failed");
    try {
      res = await rawLookup(p, 10000);
    } catch (e2) {
      throw new Error(isAbortError(e2) ? "Verse lookup timed out — check your connection and try again." : (e2 instanceof Error ? e2.message : "Lookup failed"));
    }
  }
  if (res.error && /too many requests/i.test(res.error)) {
    await sleep(400);
    try {
      res = await rawLookup(p, 5000);
    } catch (e3) {
      throw new Error(isAbortError(e3) ? "Verse lookup timed out — check your connection and try again." : (e3 instanceof Error ? e3.message : "Lookup failed"));
    }
  }
  if (res.error) throw new Error(res.error);
  const verses: BibleVerse[] = res.verses || [];
  const translation: string = res.translation || p.translationCode;
  if (verses.length > 0) setBibleCached(key, verses, translation);
  return { verses, translation, cached: !!res.cached };
}

/** Test helper. */
export function _clearBibleClientCache(): void { cache.clear(); }
export function _bibleClientCacheSize(): number { return cache.size; }
