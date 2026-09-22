// Whole-chapter client-side cache for the Bible operator UI.
//
// Rationale (see docs/plans — "rearchitect verse loading"): ProPresenter /
// EasyWorship load a whole passage/chapter ONCE, then all verse-by-verse
// navigation is a local index move — zero network. Previously every
// "Next verse" click in ProOperatorShell did a fresh `/api/bible/lookup`
// round trip. This module fetches (and caches) the ENTIRE current chapter
// the first time any verse in it is looked up, so subsequent Next/Prev
// clicks can be resolved purely from this in-memory cache.
//
// Built on top of `cachedLookup` (bible-client-cache.ts) rather than a raw
// fetch, so a verse that was already fetched this session (e.g. via the
// per-verse cache) is never re-fetched over the network — and any chapter
// fetched here also warms that cache for other call sites that still look
// up individual verses/ranges.
import { cachedLookup, type BibleVerse } from "./bible-client-cache";
import { loadOfflineChapter, saveOfflineChapter } from "./offline/bibleOfflineStore";

export type ChapterEntry = { verses: BibleVerse[]; translation: string; ts: number };

const cache = new Map<string, ChapterEntry>();
// In-flight fetches, keyed the same way, so two near-simultaneous callers
// (e.g. a Next-verse click racing a background edge-prefetch) share one
// network request instead of firing two.
const inFlight = new Map<string, Promise<ChapterEntry>>();
const CAP = 50; // chapters, not verses — generous for a single service.

// Verses in a chapter never exceed this (Psalm 119 = 176, the longest).
// Fetching 1..MAX_CHAPTER_VERSE via the existing BETWEEN-range lookup query
// reuses `/api/bible/lookup` unchanged — no server route change needed —
// and simply returns whatever verses actually exist in that chapter.
export const MAX_CHAPTER_VERSE = 200;

export function chapterKey(translationCode: string, book: string, chapter: number): string {
  return `${translationCode.toUpperCase()}:${book.toLowerCase()}:${chapter}`;
}

// PUBLIC-DOMAIN translations are locally-seeded, complete, and truly immutable,
// so they're read CACHE-FIRST (fast + offline-safe) and bulk pre-hydrated.
// Licensed ones (NIV/NKJV/NLT/ESV…) are live API.Bible snapshots — rate-limited
// (partial-response risk), server-correctable, licensing-sensitive — so they're
// read NETWORK-FIRST when online (always authoritative; a stale/partial copy is
// never served while connected) and their persisted copy is used ONLY as an
// offline fallback. Both are persisted on a complete fetch; a later complete
// fetch overwrites, so a partial licensed copy self-heals next time online.
const PUBLIC_DOMAIN_CODES = new Set([
  "KJV", "ASV", "WEB", "YLT", "DARBY", "DRC", "DRA", "GEN1599", "WBS", "BBE",
]);
// Public-domain cache-first reads expire after this so a server-side re-seed/fix
// eventually wins when the operator is back online (offline reads ignore it).
const STORE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function isPublicDomain(translationCode: string): boolean {
  return PUBLIC_DOMAIN_CODES.has(translationCode.toUpperCase());
}
// Guard against persisting an obviously-truncated chapter: real chapters begin
// at verse 1. (Public-domain reads are atomic so tail-truncation is a non-event
// for them; this is belt-and-suspenders.)
function looksComplete(verses: BibleVerse[]): boolean {
  return verses.length > 0 && verses[0]?.verse === 1;
}

export function getCachedChapter(key: string): ChapterEntry | null {
  return cache.get(key) || null;
}

function setCachedChapter(key: string, verses: BibleVerse[], translation: string): ChapterEntry {
  if (cache.size >= CAP) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  const entry: ChapterEntry = { verses, translation, ts: Date.now() };
  cache.set(key, entry);
  return entry;
}

/**
 * Fetch (or return cached) whole-chapter verse data. Safe to call
 * concurrently for the same chapter — de-duplicates in-flight requests.
 */
export async function fetchChapterCached(book: string, chapter: number, translationCode: string): Promise<ChapterEntry> {
  const key = chapterKey(translationCode, book, chapter);
  const hit = getCachedChapter(key);
  if (hit) return hit;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const online = typeof navigator === "undefined" ? true : navigator.onLine;
  const pd = isPublicDomain(translationCode);
  const promise = (async () => {
    try {
      // 1. PUBLIC-DOMAIN only: persisted copy first — immutable text, so
      //    IndexedDB is faster than the network AND works offline. When ONLINE
      //    and the copy is older than the TTL, fall through to re-fetch so a
      //    server-side correction can win; when OFFLINE, use it at any age.
      //    Licensed skips this — it's read network-first (authoritative).
      if (pd) {
        const stored = await loadOfflineChapter(key);
        if (stored && stored.verses.length > 0) {
          const fresh = Date.now() - stored.at < STORE_TTL_MS;
          if (!online || fresh) return setCachedChapter(key, stored.verses, stored.translation);
        }
      }
      // 2. Network fetch — persist any COMPLETE chapter (public-domain OR
      //    licensed-on-demand). A later complete fetch overwrites, so a partial
      //    licensed copy self-heals next time online.
      try {
        const res = await cachedLookup({
          book, chapter, verseStart: 1, verseEnd: MAX_CHAPTER_VERSE, translationCode,
        });
        const entry = setCachedChapter(key, res.verses, res.translation);
        if (looksComplete(res.verses)) {
          void saveOfflineChapter(key, { verses: res.verses, translation: res.translation, at: Date.now() });
        }
        return entry;
      } catch (netErr) {
        // 3. Network failed (offline / server down). Last-chance persisted read
        //    (public-domain OR a previously-cached licensed chapter, any age).
        const fallback = await loadOfflineChapter(key);
        if (fallback && fallback.verses.length > 0) {
          return setCachedChapter(key, fallback.verses, fallback.translation);
        }
        throw netErr;
      }
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, promise);
  return promise;
}

/** Fire-and-forget background prefetch — swallow failures, this is best-effort. */
export function prefetchChapter(book: string, chapter: number, translationCode: string): void {
  if (chapter < 1) return;
  void fetchChapterCached(book, chapter, translationCode).catch(() => { /* best-effort */ });
}

/** Test helper. */
export function _clearBibleChapterCache(): void { cache.clear(); inFlight.clear(); }

/**
 * A `/api/bible/lookup` shaped result, resolved from the CHAPTER CACHE.
 *
 * WHY THIS EXISTS (2026-09-22): three call sites — the verse bank's
 * `addReference`, its window top-up, and the "show verse" voice command —
 * POSTed `/api/bible/lookup` DIRECTLY, bypassing everything above. So an
 * operator whose whole KJV is already sitting hydrated in IndexedDB still got
 * nothing from those paths the moment the network went, which is exactly the
 * moment they matter. The cache was built and then walked around.
 *
 * Resolving a reference from a chapter we already hold is also strictly
 * cheaper than a round trip even when online, so there is no "online path" to
 * preserve separately — the network is already step 2 inside fetchChapterCached.
 *
 * `windowSize` verses either side are returned as `before` / `after`, matching
 * what the route's `withWindow: true` produced.
 */
export async function lookupWithWindowCached(
  book: string, chapter: number, verseStart: number, verseEnd: number,
  translationCode: string, windowSize = 5,
): Promise<{
  primary: BibleVerse[];
  before: BibleVerse[];
  after: BibleVerse[];
  translation: string;
}> {
  const entry = await fetchChapterCached(book, chapter, translationCode);
  const inRange = (v: BibleVerse) => v.verse >= verseStart && v.verse <= verseEnd;
  return {
    primary: entry.verses.filter(inRange),
    // `before` is the verses immediately preceding, in reading order — the
    // slice(-n) keeps the CLOSEST ones, not the first of the chapter.
    before: entry.verses.filter((v) => v.verse < verseStart).slice(-windowSize),
    after: entry.verses.filter((v) => v.verse > verseEnd).slice(0, windowSize),
    translation: entry.translation,
  };
}
