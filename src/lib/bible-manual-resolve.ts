// Manual reference resolution for the typed Bible bar (BibleMode). Turns messy
// operator-typed input into one of three outcomes — a resolved reference, a
// "did you mean" suggestion, or a signal to fall back to phrase/semantic search
// — so the input NEVER dead-ends on a "Couldn't parse reference" toast (the
// 2026-08-25 "manually writing up a reference is poor" complaint).
//
// Pure + synchronous → unit-testable in test/bible-manual-resolve.test.ts.
// It layers three accommodations on top of parseTypedReference():
//   (F1) book-less forms resolved against the currently-open chapter:
//        "verse 16", ":16", "3:16", "16-18" → carry the on-screen book/chapter.
//   (F2) chapter ranges with no colon ("Matthew 5 to 7") → load the START
//        chapter as a whole chapter (multi-chapter fan-out is not yet supported)
//        with a note, instead of silently collapsing to Matthew 5:1.
//   (DYM) a mistyped/accented book name that only resolves via fuzzy/phonetic
//        matching ("Jhn 3:16", "filipians 4:13") → a confirmable suggestion.

import { parseTypedReference, parseReference, knownBook } from "./bible-parser";

export type ResolvedRef = {
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
  chapterEnd?: number;
};

/** The reference currently displayed in the grid (book + chapter), if any. */
export type ManualContext = { book: string; chapter: number } | null;

export type ManualResolveResult =
  | { kind: "ref"; ref: ResolvedRef; note?: string }
  | { kind: "suggest"; label: string; ref: ResolvedRef; message: string }
  | { kind: "phrase" };

const RANGE_SEP = "(?:to|through|thru|-|–|—)";

function refFrom(p: { book: string; chapter: number; verseStart: number; verseEnd: number; chapterEnd?: number }): ResolvedRef {
  return { book: p.book, chapter: p.chapter, verseStart: p.verseStart, verseEnd: p.verseEnd, chapterEnd: p.chapterEnd };
}

/**
 * Resolve typed input. `context` is the currently-displayed reference so
 * book-less input ("verse 16") can be anchored to what the operator is viewing.
 */
export function resolveManualReference(rawInput: string, context: ManualContext = null): ManualResolveResult {
  const input = (rawInput ?? "").trim();
  if (!input) return { kind: "phrase" };

  // (F2) Chapter range with no colon: "Book C to C". Detected BEFORE the typed
  // parser (which would collapse it to C:1). Strip a trailing "C to C" and check
  // the remainder is exactly a book — so "John 3:16 to 18" (a verse range, has a
  // colon so the strip can't match) is left to the typed parser below.
  const chapterRange = input.match(new RegExp(`^(.+?)\\s+(\\d{1,3})\\s*${RANGE_SEP}\\s*(\\d{1,3})$`, "i"));
  if (chapterRange) {
    const book = knownBook(chapterRange[1].trim());
    const c1 = parseInt(chapterRange[2], 10);
    const c2 = parseInt(chapterRange[3], 10);
    if (book && c2 > c1 && parseReference(`${book} ${c1}`) && parseReference(`${book} ${c2}`)) {
      // verseEnd 999 loads the whole start chapter (runLookup clamps to the
      // chapter's real verses). Note keeps the collapse from being silent.
      return {
        kind: "ref",
        ref: { book, chapter: c1, verseStart: 1, verseEnd: 999 },
        note: `Showing ${book} ${c1} — the ${c1}–${c2} chapter range is loaded one chapter at a time.`,
      };
    }
  }

  // Primary path: the typed-input parser (superset of parseReferences, expands
  // typed-only abbreviations like "ex 2 1").
  const typed = parseTypedReference(input);
  if (typed.length > 0) return { kind: "ref", ref: refFrom(typed[0]) };

  // (F1) Book-less forms — only meaningful against an open chapter.
  if (context) {
    // "verse 16" / "v16" / "vs 16" / ":16" → verse N in the current chapter.
    let m = input.match(/^(?:v|vs|verse|verses)\.?\s*(\d{1,3})$/i) || input.match(/^:\s*(\d{1,3})$/);
    if (m) {
      const v = parseInt(m[1], 10);
      if (v > 0) return { kind: "ref", ref: { book: context.book, chapter: context.chapter, verseStart: v, verseEnd: v } };
    }
    // "verse 1 to 3" / ":1-3" → verse range in the current chapter.
    m = input.match(new RegExp(`^(?:v|vs|verse|verses)\\.?\\s*(\\d{1,3})\\s*${RANGE_SEP}\\s*(\\d{1,3})$`, "i"))
      || input.match(new RegExp(`^:\\s*(\\d{1,3})\\s*${RANGE_SEP}\\s*(\\d{1,3})$`));
    if (m) {
      const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      if (a > 0 && b >= a) return { kind: "ref", ref: { book: context.book, chapter: context.chapter, verseStart: a, verseEnd: b } };
    }
    // "3:16" (no book) → current book, chapter 3, verse 16.
    m = input.match(/^(\d{1,3})\s*:\s*(\d{1,3})$/);
    if (m) {
      const ch = parseInt(m[1], 10), v = parseInt(m[2], 10);
      if (ch > 0 && v > 0 && parseReference(`${context.book} ${ch}`)) {
        return { kind: "ref", ref: { book: context.book, chapter: ch, verseStart: v, verseEnd: v } };
      }
    }
    // "3:16-18" (no book) → current book verse range.
    m = input.match(new RegExp(`^(\\d{1,3})\\s*:\\s*(\\d{1,3})\\s*${RANGE_SEP}\\s*(\\d{1,3})$`));
    if (m) {
      const ch = parseInt(m[1], 10), a = parseInt(m[2], 10), b = parseInt(m[3], 10);
      if (ch > 0 && a > 0 && b >= a && parseReference(`${context.book} ${ch}`)) {
        return { kind: "ref", ref: { book: context.book, chapter: ch, verseStart: a, verseEnd: b } };
      }
    }
  }

  // (DYM) Did-you-mean: input is reference-shaped ("<word> <numbers>") but the
  // first word isn't an exact book. If it fuzzy/phonetic-resolves to a real book
  // AND the corrected input parses, offer it as a confirmable suggestion rather
  // than a dead-end. (Uses knownBook, which now includes the phonetic fallback.)
  const shaped = input.match(/^([A-Za-z]{2,}(?:\s+[A-Za-z]+){0,2})\s+(\d.*)$/);
  if (shaped) {
    const head = shaped[1].trim();
    const rest = shaped[2].trim();
    const corrected = knownBook(head);
    if (corrected && corrected.toLowerCase() !== head.toLowerCase()) {
      const reparsed = parseTypedReference(`${corrected} ${rest}`);
      if (reparsed.length > 0) {
        const p = reparsed[0];
        const label = `${p.book} ${p.chapter}:${p.verseStart}${p.verseEnd !== p.verseStart ? `-${p.verseEnd}` : ""}`;
        return { kind: "suggest", label, ref: refFrom(p), message: `Did you mean ${label}?` };
      }
    }
  }

  // Nothing reference-like resolved → let the caller run phrase/semantic search.
  return { kind: "phrase" };
}
