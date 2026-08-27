/*
 * Pure helpers for OpenFlow's Apply/Resolve logic — no I/O, unit-tested. Kept
 * separate so the title-matching and reference-labelling rules can be verified
 * without a DB.
 */

/** Normalize a song title for matching: lowercase, non-alphanumerics -> single
 *  spaces, trimmed. */
export function normalizeTitle(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Find the library title that a suggested title refers to, SAFELY — an exact
 * normalized match, or a prefix relationship where BOTH sides are substantial
 * (>=6 normalized chars). This deliberately rejects: an empty/punctuation-only
 * query (which used to match the first song via includes("")), and loose
 * mid-string overlap (e.g. "grace" binding to "Amazing Grace"). Returns the
 * index into `titles`, or -1 if there is no confident match — the caller then
 * reports it as unmatched rather than adding the wrong real song.
 */
export function matchSongIndex(titles: string[], query: string): number {
  const q = normalizeTitle(query);
  if (!q) return -1;
  const normed = titles.map(normalizeTitle);
  const exact = normed.indexOf(q);
  if (exact >= 0) return exact;
  // Prefix match handles a truncated title ("Great Is Thy" -> "Great Is Thy
  // Faithfulness") without accepting arbitrary substrings.
  return normed.findIndex((t) => t.length >= 6 && q.length >= 6 && (t.startsWith(q) || q.startsWith(t)));
}

export type ParsedRef = {
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number | null;
  chapterEnd?: number;
};

/**
 * Human label for a parsed reference. Handles: single verse ("John 3:16"),
 * same-chapter range ("Romans 8:28-39"), cross-chapter range
 * ("Romans 8:28-9:5"), and whole chapter ("Psalm 23"). Matches the app's
 * convention of NOT embedding the translation in the reference (the dedup key).
 */
export function formatScriptureLabel(r: ParsedRef): string {
  if (r.verseEnd == null) return `${r.book} ${r.chapter}`; // whole chapter
  const base = `${r.book} ${r.chapter}:${r.verseStart}`;
  if (r.chapterEnd && r.chapterEnd !== r.chapter) return `${base}-${r.chapterEnd}:${r.verseEnd}`;
  if (r.verseEnd !== r.verseStart) return `${base}-${r.verseEnd}`;
  return base;
}

/** The verseEnd to pass to lookupReference: a whole-chapter ref (verseEnd null)
 *  fetches the entire chapter via a high sentinel that lookupReference clamps to
 *  the real verse count. */
export function lookupVerseEnd(r: ParsedRef): number {
  return r.verseEnd == null ? 999 : r.verseEnd;
}
