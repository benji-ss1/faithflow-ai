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

// Only PUBLIC-DOMAIN translations are persisted offline. The licensed ones
// (NIV/NKJV/NLT/ESV…) are live API.Bible snapshots — rate-limited (so a short/
// partial response is a real risk), server-correctable, and licensing-sensitive
// — none of which should be frozen into a permanent local copy. Public-domain
// translations are locally-seeded atomic DB reads: complete and truly
// immutable. Allowlist (fail-closed): an unknown code simply isn't cached.
const PERSISTABLE_CODES = new Set([
  "KJV", "ASV", "WEB", "YLT", "DARBY", "DRC", "DRA", "GEN1599", "WBS", "BBE",
]);
// Even public-domain copies expire after this so a server-side re-seed/fix
// eventually wins when the operator is back online (offline reads ignore it).
const STORE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function isPersistable(translationCode: string): boolean {
  return PERSISTABLE_CODES.has(translationCode.toUpperCase());
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
  const persistable = isPersistable(translationCode);
  const promise = (async () => {
    try {
      // 1. Persisted copy first (public-domain only) — immutable text, so
      //    IndexedDB is faster than the network AND works offline. When ONLINE
      //    and the copy is older than the TTL, fall through to re-fetch so a
      //    server-side correction can win; when OFFLINE, use it at any age.
      if (persistable) {
        const stored = await loadOfflineChapter(key);
        if (stored && stored.verses.length > 0) {
          const fresh = Date.now() - stored.at < STORE_TTL_MS;
          if (!online || fresh) return setCachedChapter(key, stored.verses, stored.translation);
        }
      }
      // 2. Network fetch — persist only complete, public-domain chapters.
      try {
        const res = await cachedLookup({
          book, chapter, verseStart: 1, verseEnd: MAX_CHAPTER_VERSE, translationCode,
        });
        const entry = setCachedChapter(key, res.verses, res.translation);
        if (persistable && looksComplete(res.verses)) {
          void saveOfflineChapter(key, { verses: res.verses, translation: res.translation, at: Date.now() });
        }
        return entry;
      } catch (netErr) {
        // 3. Network failed (offline / server down). Last-chance persisted read
        //    (public-domain, any age) before surfacing the error.
        if (persistable) {
          const fallback = await loadOfflineChapter(key);
          if (fallback && fallback.verses.length > 0) {
            return setCachedChapter(key, fallback.verses, fallback.translation);
          }
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
