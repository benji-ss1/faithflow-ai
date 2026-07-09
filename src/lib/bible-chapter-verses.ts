/**
 * Verse counts per chapter for common Bible books.
 * Used by the operator UI to flag mis-heard scripture detections where
 * the parsed verse number exceeds the actual chapter length
 * (e.g. "Revelation 5:18" — chapter 5 only has 14 verses).
 *
 * Data source: KJV canonical counts. Book names must match the canonical
 * form produced by src/lib/bible-parser.ts.
 *
 * If a book/chapter isn't in this table, callers should treat the verse
 * as VALID (i.e. don't warn) — better a false negative than a false alarm.
 */
export const CHAPTER_VERSE_COUNTS: Record<string, number[]> = {
  Genesis: [31,25,24,26,32,22,24,22,29,32,32,20,18,24,21,16,27,33,38,18,34,24,20,67,34,35,46,22,35,43,55,32,20,31,29,43,36,30,23,23,57,38,34,34,28,34,31,22,33,26],
  Exodus: [22,25,22,31,23,30,25,32,35,29,10,51,22,31,27,36,16,27,25,26,36,31,33,18,40,37,21,43,46,38,18,35,23,35,35,38,29,31,43,38],
  Psalms: [6,12,8,8,12,10,17,9,20,18,7,8,6,7,5,11,15,50,14,9,13,31,6,10,22,12,14,9,11,12,24,11,22,22,28,12,40,22,13,17,13,11,5,26,17,11,9,14,20,23,19,9,6,7,23,13,11,11,17,12,8,12,11,10,13,20,7,35,36,5,24,20,28,23,10,12,20,72,13,19,16,8,18,12,13,17,7,18,52,17,16,15,5,23,11,13,12,9,9,5,8,28,22,35,45,48,43,13,31,7,10,10,9,8,18,19,2,29,176,7,8,9,4,8,5,6,5,6,8,8,3,18,3,3,21,26,9,8,24,13,10,7,12,15,21,10,20,14,9,6],
  Matthew: [25,23,17,25,48,34,29,34,38,42,30,50,58,36,39,28,27,35,30,34,46,46,39,51,46,75,66,20],
  Mark: [45,28,35,41,43,56,37,38,50,52,33,44,37,72,47,20],
  Luke: [80,52,38,44,39,49,50,56,62,42,54,59,35,35,32,31,37,43,48,47,38,71,56,53],
  John: [51,25,36,54,47,71,53,59,41,42,57,50,38,31,27,33,26,40,42,31,25],
  Acts: [26,47,26,37,42,15,60,40,43,48,30,25,52,28,41,40,34,28,41,38,40,30,35,27,27,32,44,31],
  Romans: [32,29,31,25,21,23,25,39,33,21,36,21,14,23,33,27],
  Revelation: [20,29,22,11,14,17,17,13,21,11,19,17,18,20,8,21,18,24,21,15,27,21],
};

/**
 * Returns the number of verses in the given chapter, or null if the
 * book/chapter is not known. Null means "don't warn".
 */
export function getChapterVerseCount(book: string, chapter: number): number | null {
  const arr = CHAPTER_VERSE_COUNTS[book];
  if (!arr) return null;
  if (chapter < 1 || chapter > arr.length) return null;
  return arr[chapter - 1];
}

/**
 * Returns true if the given verse number likely doesn't exist in the
 * chapter (heuristic — only flags when we have data for the book/chapter).
 */
export function isVerseLikelyMisheard(book: string, chapter: number, verse: number): boolean {
  const count = getChapterVerseCount(book, chapter);
  if (count === null) return false;
  return verse > count;
}
