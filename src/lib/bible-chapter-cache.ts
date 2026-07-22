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
  const promise = (async () => {
    try {
      const res = await cachedLookup({
        book, chapter, verseStart: 1, verseEnd: MAX_CHAPTER_VERSE, translationCode,
      });
      return setCachedChapter(key, res.verses, res.translation);
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
