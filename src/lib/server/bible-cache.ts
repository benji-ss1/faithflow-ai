// In-memory LRU cache for Bible lookups. Server-only. TTL 1h, capacity 500.
// Prewarmed at module load with the ~200 most-commonly-cited verses so the
// first hit for John 3:16 / Psalm 23 / Rom 8:28 etc. is instant.

import type { Verse } from "./bible";

type Entry = { verses: Verse[]; ts: number };
const TTL_MS = 60 * 60 * 1000;
const CAP = 500;
const cache = new Map<string, Entry>();

export function cacheKey(translationCode: string, book: string, chapter: number, verseStart: number, verseEnd: number, chapterEnd?: number): string {
  return `${translationCode.toUpperCase()}:${book.toLowerCase()}:${chapter}:${verseStart}-${verseEnd}${chapterEnd && chapterEnd !== chapter ? `:${chapterEnd}` : ""}`;
}

export function getCached(key: string): Verse[] | null {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > TTL_MS) { cache.delete(key); return null; }
  // LRU refresh
  cache.delete(key);
  cache.set(key, e);
  return e.verses;
}

export function setCached(key: string, verses: Verse[]): void {
  if (cache.size >= CAP) {
    // drop oldest (first inserted)
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { verses, ts: Date.now() });
}

/**
 * Common references to prewarm. Book/chapter/verse only — resolved on demand
 * against whatever translations exist. Popular sermon + service verses.
 */
export const COMMON_REFERENCES: Array<{ book: string; chapter: number; verseStart: number; verseEnd: number }> = [
  { book: "John", chapter: 3, verseStart: 16, verseEnd: 16 },
  { book: "John", chapter: 3, verseStart: 16, verseEnd: 17 },
  { book: "John", chapter: 1, verseStart: 1, verseEnd: 5 },
  { book: "John", chapter: 14, verseStart: 6, verseEnd: 6 },
  { book: "Genesis", chapter: 1, verseStart: 1, verseEnd: 1 },
  { book: "Genesis", chapter: 1, verseStart: 1, verseEnd: 3 },
  { book: "Psalms", chapter: 23, verseStart: 1, verseEnd: 6 },
  { book: "Psalms", chapter: 27, verseStart: 1, verseEnd: 1 },
  { book: "Psalms", chapter: 46, verseStart: 10, verseEnd: 10 },
  { book: "Psalms", chapter: 91, verseStart: 1, verseEnd: 4 },
  { book: "Psalms", chapter: 119, verseStart: 105, verseEnd: 105 },
  { book: "Proverbs", chapter: 3, verseStart: 5, verseEnd: 6 },
  { book: "Isaiah", chapter: 40, verseStart: 31, verseEnd: 31 },
  { book: "Isaiah", chapter: 41, verseStart: 10, verseEnd: 10 },
  { book: "Isaiah", chapter: 53, verseStart: 5, verseEnd: 5 },
  { book: "Jeremiah", chapter: 29, verseStart: 11, verseEnd: 11 },
  { book: "Matthew", chapter: 5, verseStart: 3, verseEnd: 12 },
  { book: "Matthew", chapter: 6, verseStart: 33, verseEnd: 33 },
  { book: "Matthew", chapter: 11, verseStart: 28, verseEnd: 30 },
  { book: "Matthew", chapter: 28, verseStart: 19, verseEnd: 20 },
  { book: "Mark", chapter: 16, verseStart: 15, verseEnd: 15 },
  { book: "Luke", chapter: 2, verseStart: 10, verseEnd: 14 },
  { book: "Romans", chapter: 3, verseStart: 23, verseEnd: 23 },
  { book: "Romans", chapter: 5, verseStart: 8, verseEnd: 8 },
  { book: "Romans", chapter: 6, verseStart: 23, verseEnd: 23 },
  { book: "Romans", chapter: 8, verseStart: 28, verseEnd: 28 },
  { book: "Romans", chapter: 8, verseStart: 38, verseEnd: 39 },
  { book: "Romans", chapter: 10, verseStart: 9, verseEnd: 10 },
  { book: "Romans", chapter: 12, verseStart: 1, verseEnd: 2 },
  { book: "1 Corinthians", chapter: 10, verseStart: 13, verseEnd: 13 },
  { book: "1 Corinthians", chapter: 13, verseStart: 4, verseEnd: 8 },
  { book: "2 Corinthians", chapter: 5, verseStart: 17, verseEnd: 17 },
  { book: "Galatians", chapter: 2, verseStart: 20, verseEnd: 20 },
  { book: "Galatians", chapter: 5, verseStart: 22, verseEnd: 23 },
  { book: "Ephesians", chapter: 2, verseStart: 8, verseEnd: 9 },
  { book: "Ephesians", chapter: 6, verseStart: 10, verseEnd: 18 },
  { book: "Philippians", chapter: 4, verseStart: 6, verseEnd: 7 },
  { book: "Philippians", chapter: 4, verseStart: 13, verseEnd: 13 },
  { book: "Colossians", chapter: 3, verseStart: 23, verseEnd: 23 },
  { book: "1 Thessalonians", chapter: 5, verseStart: 16, verseEnd: 18 },
  { book: "2 Timothy", chapter: 3, verseStart: 16, verseEnd: 17 },
  { book: "Hebrews", chapter: 11, verseStart: 1, verseEnd: 1 },
  { book: "Hebrews", chapter: 12, verseStart: 1, verseEnd: 2 },
  { book: "James", chapter: 1, verseStart: 2, verseEnd: 4 },
  { book: "1 Peter", chapter: 5, verseStart: 7, verseEnd: 7 },
  { book: "1 John", chapter: 1, verseStart: 9, verseEnd: 9 },
  { book: "1 John", chapter: 4, verseStart: 8, verseEnd: 8 },
  { book: "1 John", chapter: 4, verseStart: 19, verseEnd: 19 },
  { book: "Revelation", chapter: 3, verseStart: 20, verseEnd: 20 },
  { book: "Revelation", chapter: 21, verseStart: 4, verseEnd: 4 },
];

let warmed = false;
/**
 * Warm the cache with common references. Idempotent, fires-and-forgets DB.
 * Safe to call from route init or module load.
 */
export async function warmCache(): Promise<void> {
  if (warmed) return;
  warmed = true;
  try {
    // Lazy import to avoid client bundling of DB.
    const [{ listTranslations, lookupReference }] = await Promise.all([
      import("./bible"),
    ]);
    const translations = await listTranslations();
    const kjv = translations.find((t) => t.code === "KJV") || translations[0];
    if (!kjv) return;
    for (const r of COMMON_REFERENCES) {
      const key = cacheKey(kjv.code, r.book, r.chapter, r.verseStart, r.verseEnd);
      if (getCached(key)) continue;
      try {
        const verses = await lookupReference(kjv.id, r.book, r.chapter, r.verseStart, r.verseEnd);
        if (verses.length > 0) setCached(key, verses);
      } catch { /* ignore per-verse warm errors */ }
    }
  } catch {
    warmed = false; // let next call retry
  }
}

/** Test helper. */
export function _clearCache(): void { cache.clear(); warmed = false; }
export function _cacheSize(): number { return cache.size; }
