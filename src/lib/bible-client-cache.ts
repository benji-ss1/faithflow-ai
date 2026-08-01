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
    res = await rawLookup(p, 2000);
  } catch (e) {
    if (!isAbortError(e)) throw new Error(e instanceof Error ? e.message : "Lookup failed");
    try {
      res = await rawLookup(p, 3000);
    } catch (e2) {
      throw new Error(isAbortError(e2) ? "Verse lookup timed out — check your connection and try again." : (e2 instanceof Error ? e2.message : "Lookup failed"));
    }
  }
  if (res.error && /too many requests/i.test(res.error)) {
    await sleep(200);
    try {
      res = await rawLookup(p, 2000);
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

/**
 * Top ~50 most-preached references. Warming these at session start makes
 * the majority of auto-fire lookups instant (cache hit, no network).
 * Kept small to avoid hammering the API on session start — the server-side
 * cache has ~200 references for the long tail.
 */
const CLIENT_WARM_REFS: Array<{ book: string; chapter: number; verseStart: number; verseEnd: number }> = [
  { book: "John", chapter: 3, verseStart: 16, verseEnd: 16 },
  { book: "Psalms", chapter: 23, verseStart: 1, verseEnd: 6 },
  { book: "Romans", chapter: 8, verseStart: 28, verseEnd: 28 },
  { book: "Philippians", chapter: 4, verseStart: 13, verseEnd: 13 },
  { book: "Jeremiah", chapter: 29, verseStart: 11, verseEnd: 11 },
  { book: "Proverbs", chapter: 3, verseStart: 5, verseEnd: 6 },
  { book: "Isaiah", chapter: 41, verseStart: 10, verseEnd: 10 },
  { book: "Romans", chapter: 8, verseStart: 37, verseEnd: 39 },
  { book: "Philippians", chapter: 4, verseStart: 6, verseEnd: 7 },
  { book: "Matthew", chapter: 6, verseStart: 33, verseEnd: 33 },
  { book: "Hebrews", chapter: 11, verseStart: 1, verseEnd: 1 },
  { book: "Romans", chapter: 12, verseStart: 1, verseEnd: 2 },
  { book: "Galatians", chapter: 5, verseStart: 22, verseEnd: 23 },
  { book: "Ephesians", chapter: 2, verseStart: 8, verseEnd: 9 },
  { book: "2 Timothy", chapter: 1, verseStart: 7, verseEnd: 7 },
  { book: "Isaiah", chapter: 40, verseStart: 31, verseEnd: 31 },
  { book: "Matthew", chapter: 11, verseStart: 28, verseEnd: 30 },
  { book: "1 Corinthians", chapter: 13, verseStart: 4, verseEnd: 8 },
  { book: "Romans", chapter: 3, verseStart: 23, verseEnd: 23 },
  { book: "Romans", chapter: 6, verseStart: 23, verseEnd: 23 },
  { book: "Joshua", chapter: 1, verseStart: 9, verseEnd: 9 },
  { book: "Psalms", chapter: 46, verseStart: 10, verseEnd: 10 },
  { book: "Psalms", chapter: 91, verseStart: 1, verseEnd: 4 },
  { book: "Psalms", chapter: 119, verseStart: 105, verseEnd: 105 },
  { book: "2 Corinthians", chapter: 5, verseStart: 17, verseEnd: 17 },
  { book: "Galatians", chapter: 2, verseStart: 20, verseEnd: 20 },
  { book: "Ephesians", chapter: 6, verseStart: 10, verseEnd: 18 },
  { book: "Hebrews", chapter: 12, verseStart: 1, verseEnd: 2 },
  { book: "James", chapter: 1, verseStart: 2, verseEnd: 4 },
  { book: "1 Peter", chapter: 5, verseStart: 7, verseEnd: 7 },
  { book: "Genesis", chapter: 1, verseStart: 1, verseEnd: 1 },
  { book: "Isaiah", chapter: 53, verseStart: 5, verseEnd: 5 },
  { book: "Matthew", chapter: 28, verseStart: 19, verseEnd: 20 },
  { book: "John", chapter: 14, verseStart: 6, verseEnd: 6 },
  { book: "John", chapter: 10, verseStart: 10, verseEnd: 10 },
  { book: "Romans", chapter: 5, verseStart: 8, verseEnd: 8 },
  { book: "Romans", chapter: 10, verseStart: 9, verseEnd: 10 },
  { book: "Philippians", chapter: 4, verseStart: 19, verseEnd: 19 },
  { book: "Colossians", chapter: 3, verseStart: 23, verseEnd: 23 },
  { book: "1 Thessalonians", chapter: 5, verseStart: 16, verseEnd: 18 },
];

let clientWarmed = false;

/**
 * Pre-warm the client-side Bible cache with common references. Call once
 * when the audio session starts. Runs in background, never blocks.
 * Batches requests to avoid hammering the API.
 */
export async function prewarmClientBibleCache(translationCode = "KJV"): Promise<void> {
  if (clientWarmed) return;
  clientWarmed = true;
  const BATCH = 5;
  const GAP = 100;
  for (let i = 0; i < CLIENT_WARM_REFS.length; i += BATCH) {
    const batch = CLIENT_WARM_REFS.slice(i, i + BATCH);
    await Promise.allSettled(
      batch.map((r) => {
        const key = bibleCacheKey(translationCode, r.book, r.chapter, r.verseStart, r.verseEnd);
        if (cache.has(key)) return Promise.resolve();
        return rawLookup({ ...r, translationCode, source: "ai" }, 2000)
          .then((res) => {
            if (res.verses && res.verses.length > 0) {
              setBibleCached(key, res.verses, res.translation || translationCode);
            }
          })
          .catch(() => { /* ignore warm errors */ });
      }),
    );
    if (i + BATCH < CLIENT_WARM_REFS.length) {
      await sleep(GAP);
    }
  }
}

/** Test helper. */
export function _clearBibleClientCache(): void { cache.clear(); clientWarmed = false; }
export function _bibleClientCacheSize(): number { return cache.size; }
