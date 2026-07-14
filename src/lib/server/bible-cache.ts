// In-memory LRU cache for Bible lookups. Server-only. TTL 1h, capacity 500.
// Prewarmed at module load with the ~200 most-commonly-cited verses so the
// first hit for John 3:16 / Psalm 23 / Rom 8:28 etc. is instant.

import type { Verse } from "./bible";

type Entry = { verses: Verse[]; ts: number };
const TTL_MS = 60 * 60 * 1000;
const CAP = 500;
const cache = new Map<string, Entry>();

const LOG_HITS = process.env.NODE_ENV !== "production" || process.env.PF_BIBLE_CACHE_LOG === "1";

export function cacheKey(translationCode: string, book: string, chapter: number, verseStart: number, verseEnd: number, chapterEnd?: number): string {
  return `${translationCode.toUpperCase()}:${book.toLowerCase()}:${chapter}:${verseStart}-${verseEnd}${chapterEnd && chapterEnd !== chapter ? `:${chapterEnd}` : ""}`;
}

export function getCached(key: string): Verse[] | null {
  const e = cache.get(key);
  if (!e) { if (LOG_HITS) console.log(`[bible-cache] MISS ${key}`); return null; }
  if (Date.now() - e.ts > TTL_MS) { cache.delete(key); if (LOG_HITS) console.log(`[bible-cache] MISS ${key} (expired)`); return null; }
  // LRU refresh
  cache.delete(key);
  cache.set(key, e);
  if (LOG_HITS) console.log(`[bible-cache] HIT ${key}`);
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
 * Common references to prewarm. Expanded to ~200 popular sermon/service
 * verses (was 50). Book/chapter/verse only — resolved on demand against
 * whatever translations exist.
 */
export const COMMON_REFERENCES: Array<{ book: string; chapter: number; verseStart: number; verseEnd: number }> = [
  // Gospels — foundational
  { book: "John", chapter: 3, verseStart: 16, verseEnd: 16 },
  { book: "John", chapter: 3, verseStart: 16, verseEnd: 17 },
  { book: "John", chapter: 1, verseStart: 1, verseEnd: 5 },
  { book: "John", chapter: 1, verseStart: 12, verseEnd: 14 },
  { book: "John", chapter: 4, verseStart: 24, verseEnd: 24 },
  { book: "John", chapter: 6, verseStart: 35, verseEnd: 35 },
  { book: "John", chapter: 8, verseStart: 12, verseEnd: 12 },
  { book: "John", chapter: 8, verseStart: 32, verseEnd: 32 },
  { book: "John", chapter: 10, verseStart: 10, verseEnd: 11 },
  { book: "John", chapter: 11, verseStart: 25, verseEnd: 26 },
  { book: "John", chapter: 13, verseStart: 34, verseEnd: 35 },
  { book: "John", chapter: 14, verseStart: 1, verseEnd: 3 },
  { book: "John", chapter: 14, verseStart: 6, verseEnd: 6 },
  { book: "John", chapter: 14, verseStart: 27, verseEnd: 27 },
  { book: "John", chapter: 15, verseStart: 5, verseEnd: 5 },
  { book: "John", chapter: 15, verseStart: 13, verseEnd: 13 },
  { book: "John", chapter: 16, verseStart: 33, verseEnd: 33 },
  { book: "John", chapter: 20, verseStart: 29, verseEnd: 29 },
  // Genesis
  { book: "Genesis", chapter: 1, verseStart: 1, verseEnd: 1 },
  { book: "Genesis", chapter: 1, verseStart: 1, verseEnd: 3 },
  { book: "Genesis", chapter: 1, verseStart: 26, verseEnd: 27 },
  { book: "Genesis", chapter: 2, verseStart: 7, verseEnd: 7 },
  { book: "Genesis", chapter: 3, verseStart: 15, verseEnd: 15 },
  { book: "Genesis", chapter: 12, verseStart: 2, verseEnd: 3 },
  { book: "Genesis", chapter: 22, verseStart: 8, verseEnd: 8 },
  { book: "Genesis", chapter: 50, verseStart: 20, verseEnd: 20 },
  // Exodus
  { book: "Exodus", chapter: 3, verseStart: 14, verseEnd: 14 },
  { book: "Exodus", chapter: 14, verseStart: 14, verseEnd: 14 },
  { book: "Exodus", chapter: 20, verseStart: 1, verseEnd: 17 },
  // Deuteronomy
  { book: "Deuteronomy", chapter: 6, verseStart: 4, verseEnd: 9 },
  { book: "Deuteronomy", chapter: 31, verseStart: 6, verseEnd: 6 },
  // Joshua
  { book: "Joshua", chapter: 1, verseStart: 8, verseEnd: 9 },
  { book: "Joshua", chapter: 24, verseStart: 15, verseEnd: 15 },
  // Psalms
  { book: "Psalms", chapter: 1, verseStart: 1, verseEnd: 3 },
  { book: "Psalms", chapter: 8, verseStart: 3, verseEnd: 4 },
  { book: "Psalms", chapter: 16, verseStart: 11, verseEnd: 11 },
  { book: "Psalms", chapter: 19, verseStart: 1, verseEnd: 1 },
  { book: "Psalms", chapter: 19, verseStart: 14, verseEnd: 14 },
  { book: "Psalms", chapter: 23, verseStart: 1, verseEnd: 6 },
  { book: "Psalms", chapter: 27, verseStart: 1, verseEnd: 1 },
  { book: "Psalms", chapter: 27, verseStart: 4, verseEnd: 4 },
  { book: "Psalms", chapter: 34, verseStart: 8, verseEnd: 8 },
  { book: "Psalms", chapter: 34, verseStart: 18, verseEnd: 18 },
  { book: "Psalms", chapter: 37, verseStart: 4, verseEnd: 4 },
  { book: "Psalms", chapter: 42, verseStart: 1, verseEnd: 2 },
  { book: "Psalms", chapter: 46, verseStart: 1, verseEnd: 3 },
  { book: "Psalms", chapter: 46, verseStart: 10, verseEnd: 10 },
  { book: "Psalms", chapter: 51, verseStart: 10, verseEnd: 12 },
  { book: "Psalms", chapter: 55, verseStart: 22, verseEnd: 22 },
  { book: "Psalms", chapter: 62, verseStart: 1, verseEnd: 2 },
  { book: "Psalms", chapter: 63, verseStart: 1, verseEnd: 4 },
  { book: "Psalms", chapter: 91, verseStart: 1, verseEnd: 4 },
  { book: "Psalms", chapter: 91, verseStart: 11, verseEnd: 12 },
  { book: "Psalms", chapter: 100, verseStart: 1, verseEnd: 5 },
  { book: "Psalms", chapter: 103, verseStart: 1, verseEnd: 5 },
  { book: "Psalms", chapter: 118, verseStart: 24, verseEnd: 24 },
  { book: "Psalms", chapter: 119, verseStart: 11, verseEnd: 11 },
  { book: "Psalms", chapter: 119, verseStart: 105, verseEnd: 105 },
  { book: "Psalms", chapter: 121, verseStart: 1, verseEnd: 2 },
  { book: "Psalms", chapter: 139, verseStart: 13, verseEnd: 14 },
  { book: "Psalms", chapter: 139, verseStart: 23, verseEnd: 24 },
  { book: "Psalms", chapter: 143, verseStart: 8, verseEnd: 8 },
  { book: "Psalms", chapter: 145, verseStart: 8, verseEnd: 9 },
  { book: "Psalms", chapter: 150, verseStart: 6, verseEnd: 6 },
  // Proverbs
  { book: "Proverbs", chapter: 3, verseStart: 5, verseEnd: 6 },
  { book: "Proverbs", chapter: 3, verseStart: 7, verseEnd: 8 },
  { book: "Proverbs", chapter: 16, verseStart: 3, verseEnd: 3 },
  { book: "Proverbs", chapter: 16, verseStart: 9, verseEnd: 9 },
  { book: "Proverbs", chapter: 18, verseStart: 10, verseEnd: 10 },
  { book: "Proverbs", chapter: 22, verseStart: 6, verseEnd: 6 },
  { book: "Proverbs", chapter: 27, verseStart: 17, verseEnd: 17 },
  // Ecclesiastes
  { book: "Ecclesiastes", chapter: 3, verseStart: 1, verseEnd: 8 },
  // Isaiah
  { book: "Isaiah", chapter: 6, verseStart: 8, verseEnd: 8 },
  { book: "Isaiah", chapter: 9, verseStart: 6, verseEnd: 7 },
  { book: "Isaiah", chapter: 26, verseStart: 3, verseEnd: 4 },
  { book: "Isaiah", chapter: 40, verseStart: 28, verseEnd: 31 },
  { book: "Isaiah", chapter: 40, verseStart: 31, verseEnd: 31 },
  { book: "Isaiah", chapter: 41, verseStart: 10, verseEnd: 10 },
  { book: "Isaiah", chapter: 43, verseStart: 2, verseEnd: 2 },
  { book: "Isaiah", chapter: 53, verseStart: 4, verseEnd: 6 },
  { book: "Isaiah", chapter: 53, verseStart: 5, verseEnd: 5 },
  { book: "Isaiah", chapter: 55, verseStart: 8, verseEnd: 9 },
  { book: "Isaiah", chapter: 55, verseStart: 11, verseEnd: 11 },
  { book: "Isaiah", chapter: 61, verseStart: 1, verseEnd: 3 },
  { book: "Isaiah", chapter: 64, verseStart: 8, verseEnd: 8 },
  // Jeremiah
  { book: "Jeremiah", chapter: 1, verseStart: 5, verseEnd: 5 },
  { book: "Jeremiah", chapter: 17, verseStart: 7, verseEnd: 8 },
  { book: "Jeremiah", chapter: 29, verseStart: 11, verseEnd: 13 },
  { book: "Jeremiah", chapter: 29, verseStart: 11, verseEnd: 11 },
  { book: "Jeremiah", chapter: 33, verseStart: 3, verseEnd: 3 },
  // Lamentations
  { book: "Lamentations", chapter: 3, verseStart: 22, verseEnd: 24 },
  // Ezekiel
  { book: "Ezekiel", chapter: 36, verseStart: 26, verseEnd: 27 },
  // Daniel
  { book: "Daniel", chapter: 3, verseStart: 17, verseEnd: 18 },
  // Micah
  { book: "Micah", chapter: 6, verseStart: 8, verseEnd: 8 },
  // Habakkuk
  { book: "Habakkuk", chapter: 3, verseStart: 17, verseEnd: 19 },
  // Zephaniah
  { book: "Zephaniah", chapter: 3, verseStart: 17, verseEnd: 17 },
  // Malachi
  { book: "Malachi", chapter: 3, verseStart: 10, verseEnd: 10 },
  // Matthew
  { book: "Matthew", chapter: 4, verseStart: 4, verseEnd: 4 },
  { book: "Matthew", chapter: 5, verseStart: 3, verseEnd: 12 },
  { book: "Matthew", chapter: 5, verseStart: 13, verseEnd: 16 },
  { book: "Matthew", chapter: 6, verseStart: 9, verseEnd: 13 },
  { book: "Matthew", chapter: 6, verseStart: 25, verseEnd: 34 },
  { book: "Matthew", chapter: 6, verseStart: 33, verseEnd: 33 },
  { book: "Matthew", chapter: 7, verseStart: 7, verseEnd: 8 },
  { book: "Matthew", chapter: 11, verseStart: 28, verseEnd: 30 },
  { book: "Matthew", chapter: 16, verseStart: 24, verseEnd: 26 },
  { book: "Matthew", chapter: 18, verseStart: 20, verseEnd: 20 },
  { book: "Matthew", chapter: 22, verseStart: 37, verseEnd: 40 },
  { book: "Matthew", chapter: 28, verseStart: 6, verseEnd: 6 },
  { book: "Matthew", chapter: 28, verseStart: 19, verseEnd: 20 },
  // Mark
  { book: "Mark", chapter: 10, verseStart: 27, verseEnd: 27 },
  { book: "Mark", chapter: 10, verseStart: 45, verseEnd: 45 },
  { book: "Mark", chapter: 12, verseStart: 30, verseEnd: 31 },
  { book: "Mark", chapter: 16, verseStart: 15, verseEnd: 15 },
  // Luke
  { book: "Luke", chapter: 1, verseStart: 37, verseEnd: 37 },
  { book: "Luke", chapter: 2, verseStart: 10, verseEnd: 14 },
  { book: "Luke", chapter: 6, verseStart: 27, verseEnd: 31 },
  { book: "Luke", chapter: 6, verseStart: 38, verseEnd: 38 },
  { book: "Luke", chapter: 9, verseStart: 23, verseEnd: 24 },
  { book: "Luke", chapter: 10, verseStart: 27, verseEnd: 27 },
  { book: "Luke", chapter: 15, verseStart: 11, verseEnd: 24 },
  // Acts
  { book: "Acts", chapter: 1, verseStart: 8, verseEnd: 8 },
  { book: "Acts", chapter: 2, verseStart: 38, verseEnd: 39 },
  { book: "Acts", chapter: 4, verseStart: 12, verseEnd: 12 },
  { book: "Acts", chapter: 16, verseStart: 31, verseEnd: 31 },
  { book: "Acts", chapter: 17, verseStart: 28, verseEnd: 28 },
  { book: "Acts", chapter: 20, verseStart: 24, verseEnd: 24 },
  // Romans
  { book: "Romans", chapter: 1, verseStart: 16, verseEnd: 17 },
  { book: "Romans", chapter: 3, verseStart: 23, verseEnd: 24 },
  { book: "Romans", chapter: 3, verseStart: 23, verseEnd: 23 },
  { book: "Romans", chapter: 5, verseStart: 1, verseEnd: 2 },
  { book: "Romans", chapter: 5, verseStart: 8, verseEnd: 8 },
  { book: "Romans", chapter: 6, verseStart: 23, verseEnd: 23 },
  { book: "Romans", chapter: 8, verseStart: 1, verseEnd: 2 },
  { book: "Romans", chapter: 8, verseStart: 18, verseEnd: 18 },
  { book: "Romans", chapter: 8, verseStart: 28, verseEnd: 28 },
  { book: "Romans", chapter: 8, verseStart: 31, verseEnd: 32 },
  { book: "Romans", chapter: 8, verseStart: 37, verseEnd: 39 },
  { book: "Romans", chapter: 8, verseStart: 38, verseEnd: 39 },
  { book: "Romans", chapter: 10, verseStart: 9, verseEnd: 10 },
  { book: "Romans", chapter: 10, verseStart: 13, verseEnd: 13 },
  { book: "Romans", chapter: 12, verseStart: 1, verseEnd: 2 },
  { book: "Romans", chapter: 12, verseStart: 9, verseEnd: 21 },
  { book: "Romans", chapter: 15, verseStart: 13, verseEnd: 13 },
  // 1 Corinthians
  { book: "1 Corinthians", chapter: 1, verseStart: 18, verseEnd: 18 },
  { book: "1 Corinthians", chapter: 6, verseStart: 19, verseEnd: 20 },
  { book: "1 Corinthians", chapter: 10, verseStart: 13, verseEnd: 13 },
  { book: "1 Corinthians", chapter: 10, verseStart: 31, verseEnd: 31 },
  { book: "1 Corinthians", chapter: 13, verseStart: 1, verseEnd: 8 },
  { book: "1 Corinthians", chapter: 13, verseStart: 4, verseEnd: 8 },
  { book: "1 Corinthians", chapter: 13, verseStart: 13, verseEnd: 13 },
  { book: "1 Corinthians", chapter: 15, verseStart: 3, verseEnd: 4 },
  { book: "1 Corinthians", chapter: 15, verseStart: 57, verseEnd: 58 },
  { book: "1 Corinthians", chapter: 16, verseStart: 13, verseEnd: 14 },
  // 2 Corinthians
  { book: "2 Corinthians", chapter: 4, verseStart: 16, verseEnd: 18 },
  { book: "2 Corinthians", chapter: 5, verseStart: 7, verseEnd: 7 },
  { book: "2 Corinthians", chapter: 5, verseStart: 17, verseEnd: 17 },
  { book: "2 Corinthians", chapter: 5, verseStart: 21, verseEnd: 21 },
  { book: "2 Corinthians", chapter: 9, verseStart: 6, verseEnd: 8 },
  { book: "2 Corinthians", chapter: 12, verseStart: 9, verseEnd: 10 },
  // Galatians
  { book: "Galatians", chapter: 2, verseStart: 20, verseEnd: 20 },
  { book: "Galatians", chapter: 5, verseStart: 1, verseEnd: 1 },
  { book: "Galatians", chapter: 5, verseStart: 22, verseEnd: 23 },
  { book: "Galatians", chapter: 6, verseStart: 9, verseEnd: 9 },
  // Ephesians
  { book: "Ephesians", chapter: 1, verseStart: 3, verseEnd: 6 },
  { book: "Ephesians", chapter: 2, verseStart: 8, verseEnd: 10 },
  { book: "Ephesians", chapter: 2, verseStart: 8, verseEnd: 9 },
  { book: "Ephesians", chapter: 3, verseStart: 20, verseEnd: 21 },
  { book: "Ephesians", chapter: 4, verseStart: 32, verseEnd: 32 },
  { book: "Ephesians", chapter: 5, verseStart: 1, verseEnd: 2 },
  { book: "Ephesians", chapter: 6, verseStart: 10, verseEnd: 18 },
  // Philippians
  { book: "Philippians", chapter: 1, verseStart: 6, verseEnd: 6 },
  { book: "Philippians", chapter: 2, verseStart: 3, verseEnd: 4 },
  { book: "Philippians", chapter: 2, verseStart: 5, verseEnd: 11 },
  { book: "Philippians", chapter: 3, verseStart: 13, verseEnd: 14 },
  { book: "Philippians", chapter: 4, verseStart: 4, verseEnd: 7 },
  { book: "Philippians", chapter: 4, verseStart: 6, verseEnd: 7 },
  { book: "Philippians", chapter: 4, verseStart: 8, verseEnd: 9 },
  { book: "Philippians", chapter: 4, verseStart: 13, verseEnd: 13 },
  { book: "Philippians", chapter: 4, verseStart: 19, verseEnd: 19 },
  // Colossians
  { book: "Colossians", chapter: 3, verseStart: 1, verseEnd: 4 },
  { book: "Colossians", chapter: 3, verseStart: 12, verseEnd: 17 },
  { book: "Colossians", chapter: 3, verseStart: 23, verseEnd: 24 },
  { book: "Colossians", chapter: 3, verseStart: 23, verseEnd: 23 },
  // 1 Thessalonians
  { book: "1 Thessalonians", chapter: 5, verseStart: 16, verseEnd: 18 },
  // 2 Thessalonians
  { book: "2 Thessalonians", chapter: 3, verseStart: 3, verseEnd: 3 },
  // 1 Timothy
  { book: "1 Timothy", chapter: 4, verseStart: 12, verseEnd: 12 },
  { book: "1 Timothy", chapter: 6, verseStart: 6, verseEnd: 8 },
  // 2 Timothy
  { book: "2 Timothy", chapter: 1, verseStart: 7, verseEnd: 7 },
  { book: "2 Timothy", chapter: 2, verseStart: 15, verseEnd: 15 },
  { book: "2 Timothy", chapter: 3, verseStart: 16, verseEnd: 17 },
  { book: "2 Timothy", chapter: 4, verseStart: 7, verseEnd: 8 },
  // Titus
  { book: "Titus", chapter: 2, verseStart: 11, verseEnd: 14 },
  // Hebrews
  { book: "Hebrews", chapter: 4, verseStart: 12, verseEnd: 12 },
  { book: "Hebrews", chapter: 4, verseStart: 15, verseEnd: 16 },
  { book: "Hebrews", chapter: 10, verseStart: 24, verseEnd: 25 },
  { book: "Hebrews", chapter: 11, verseStart: 1, verseEnd: 1 },
  { book: "Hebrews", chapter: 11, verseStart: 6, verseEnd: 6 },
  { book: "Hebrews", chapter: 12, verseStart: 1, verseEnd: 3 },
  { book: "Hebrews", chapter: 12, verseStart: 1, verseEnd: 2 },
  { book: "Hebrews", chapter: 13, verseStart: 5, verseEnd: 6 },
  { book: "Hebrews", chapter: 13, verseStart: 8, verseEnd: 8 },
  // James
  { book: "James", chapter: 1, verseStart: 2, verseEnd: 4 },
  { book: "James", chapter: 1, verseStart: 5, verseEnd: 5 },
  { book: "James", chapter: 1, verseStart: 19, verseEnd: 20 },
  { book: "James", chapter: 1, verseStart: 22, verseEnd: 25 },
  { book: "James", chapter: 4, verseStart: 7, verseEnd: 8 },
  { book: "James", chapter: 5, verseStart: 16, verseEnd: 16 },
  // 1 Peter
  { book: "1 Peter", chapter: 2, verseStart: 9, verseEnd: 10 },
  { book: "1 Peter", chapter: 2, verseStart: 24, verseEnd: 24 },
  { book: "1 Peter", chapter: 3, verseStart: 15, verseEnd: 15 },
  { book: "1 Peter", chapter: 5, verseStart: 6, verseEnd: 7 },
  { book: "1 Peter", chapter: 5, verseStart: 7, verseEnd: 7 },
  { book: "1 Peter", chapter: 5, verseStart: 10, verseEnd: 11 },
  // 2 Peter
  { book: "2 Peter", chapter: 1, verseStart: 3, verseEnd: 4 },
  { book: "2 Peter", chapter: 3, verseStart: 9, verseEnd: 9 },
  // 1 John
  { book: "1 John", chapter: 1, verseStart: 7, verseEnd: 9 },
  { book: "1 John", chapter: 1, verseStart: 9, verseEnd: 9 },
  { book: "1 John", chapter: 3, verseStart: 1, verseEnd: 3 },
  { book: "1 John", chapter: 3, verseStart: 16, verseEnd: 18 },
  { book: "1 John", chapter: 4, verseStart: 7, verseEnd: 12 },
  { book: "1 John", chapter: 4, verseStart: 8, verseEnd: 8 },
  { book: "1 John", chapter: 4, verseStart: 18, verseEnd: 19 },
  { book: "1 John", chapter: 4, verseStart: 19, verseEnd: 19 },
  { book: "1 John", chapter: 5, verseStart: 4, verseEnd: 5 },
  // Revelation
  { book: "Revelation", chapter: 1, verseStart: 8, verseEnd: 8 },
  { book: "Revelation", chapter: 3, verseStart: 20, verseEnd: 20 },
  { book: "Revelation", chapter: 4, verseStart: 11, verseEnd: 11 },
  { book: "Revelation", chapter: 5, verseStart: 12, verseEnd: 13 },
  { book: "Revelation", chapter: 21, verseStart: 1, verseEnd: 4 },
  { book: "Revelation", chapter: 21, verseStart: 4, verseEnd: 4 },
  { book: "Revelation", chapter: 22, verseStart: 12, verseEnd: 13 },
  { book: "Revelation", chapter: 22, verseStart: 20, verseEnd: 21 },
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
    let warmedCount = 0;
    for (const r of COMMON_REFERENCES) {
      const key = cacheKey(kjv.code, r.book, r.chapter, r.verseStart, r.verseEnd);
      if (cache.has(key)) continue;
      try {
        const verses = await lookupReference(kjv.id, r.book, r.chapter, r.verseStart, r.verseEnd);
        if (verses.length > 0) { setCached(key, verses); warmedCount++; }
      } catch { /* ignore per-verse warm errors */ }
    }
    if (LOG_HITS) console.log(`[bible-cache] warmed ${warmedCount}/${COMMON_REFERENCES.length} references (${kjv.code})`);
  } catch {
    warmed = false; // let next call retry
  }
}

/** Test helper. */
export function _clearCache(): void { cache.clear(); warmed = false; }
export function _cacheSize(): number { return cache.size; }
