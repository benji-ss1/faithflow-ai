/**
 * Rule-based Bible reference parser. Scans a transcript segment for spoken
 * references and returns any matches with a confidence score (0–100).
 *
 * Handles:
 *  - "John 3:16", "John 3 16", "John chapter 3 verse 16"
 *  - "John three sixteen", "John chapter three verse sixteen"
 *  - "First Corinthians 13", "1 Corinthians 13:1-3", "one corinthians thirteen"
 *  - "Psalm 91", "Genesis 1 from verse 1 to 3"
 *  - Common speech-recognition mishearings (e.g. "psalms" for "psalm")
 *
 * Does NOT do arbitrary NLU — it's a fast pattern matcher. Ambiguous or
 * low-confidence matches are candidates for semantic fallback (Layer 2).
 *
 * All comparisons are lower-cased and diacritic-stripped.
 */

// --- Book dictionary --------------------------------------------------------
// Maps normalized variants to the canonical book name used in bible_verses.
const RAW_BOOKS: [string, string[]][] = [
  // NOTE: two-letter aliases that collide with common English words have
  // been dropped to prevent false positives during live services:
  //   "ex" (Exodus), "ru" (Ruth), "is" (Isaiah), "am" (Amos), "ac" (Acts),
  //   "re" (Revelation). See R2 in the Priority-1 review.
  ["Genesis", ["genesis", "gen", "gn", "ge"]],
  ["Exodus", ["exodus", "exod", "exo"]],
  ["Leviticus", ["leviticus", "lev", "lv"]],
  ["Numbers", ["numbers", "num", "nm", "nb"]],
  ["Deuteronomy", ["deuteronomy", "deut", "deu", "dt"]],
  ["Joshua", ["joshua", "josh", "jos"]],
  ["Judges", ["judges", "judg", "jdg", "jgs"]],
  ["Ruth", ["ruth", "rut"]],
  ["1 Samuel", ["1 samuel", "first samuel", "1st samuel", "one samuel", "i samuel", "1 sam", "1sam", "1 sm", "1s"]],
  ["2 Samuel", ["2 samuel", "second samuel", "2nd samuel", "two samuel", "ii samuel", "2 sam", "2sam", "2 sm", "2s"]],
  ["1 Kings", ["1 kings", "first kings", "1st kings", "one kings", "i kings", "1 kgs", "1kgs"]],
  ["2 Kings", ["2 kings", "second kings", "2nd kings", "two kings", "ii kings", "2 kgs", "2kgs"]],
  ["1 Chronicles", ["1 chronicles", "first chronicles", "1st chronicles", "one chronicles", "i chronicles", "1 chron", "1 ch"]],
  ["2 Chronicles", ["2 chronicles", "second chronicles", "2nd chronicles", "two chronicles", "ii chronicles", "2 chron", "2 ch"]],
  ["Ezra", ["ezra", "ezr"]],
  ["Nehemiah", ["nehemiah", "neh"]],
  ["Esther", ["esther", "esth", "est"]],
  ["Job", ["job", "jb"]],
  ["Psalms", ["psalms", "psalm", "ps", "pslm", "psa", "pss"]],
  ["Proverbs", ["proverbs", "proverb", "prov", "prv", "pro"]],
  ["Ecclesiastes", ["ecclesiastes", "eccl", "ecc", "qoh"]],
  ["Song of Solomon", ["song of solomon", "song of songs", "songs", "song", "sos", "cant", "canticles"]],
  ["Isaiah", ["isaiah", "isa"]],
  ["Jeremiah", ["jeremiah", "jer"]],
  ["Lamentations", ["lamentations", "lam"]],
  ["Ezekiel", ["ezekiel", "ezek", "ez"]],
  ["Daniel", ["daniel", "dan", "dn"]],
  ["Hosea", ["hosea", "hos"]],
  ["Joel", ["joel", "jl"]],
  ["Amos", ["amos"]],
  ["Obadiah", ["obadiah", "obad", "ob"]],
  ["Jonah", ["jonah", "jon"]],
  ["Micah", ["micah", "mic", "mi"]],
  ["Nahum", ["nahum", "nah", "na"]],
  ["Habakkuk", ["habakkuk", "hab"]],
  ["Zephaniah", ["zephaniah", "zeph", "zep"]],
  ["Haggai", ["haggai", "hag"]],
  ["Zechariah", ["zechariah", "zech", "zec"]],
  ["Malachi", ["malachi", "mal"]],
  ["Matthew", ["matthew", "matt", "mt"]],
  ["Mark", ["mark", "mk", "mr"]],
  ["Luke", ["luke", "lk", "lu"]],
  ["John", ["john", "jn", "jhn"]],
  ["Acts", ["acts", "act"]],
  ["Romans", ["romans", "roman", "rom", "rm"]],
  ["1 Corinthians", ["1 corinthians", "first corinthians", "1st corinthians", "one corinthians", "i corinthians", "1 cor", "1cor", "i cor"]],
  ["2 Corinthians", ["2 corinthians", "second corinthians", "2nd corinthians", "two corinthians", "ii corinthians", "2 cor", "2cor", "ii cor"]],
  ["Galatians", ["galatians", "gal"]],
  ["Ephesians", ["ephesians", "eph"]],
  ["Philippians", ["philippians", "phil", "php"]],
  ["Colossians", ["colossians", "col"]],
  ["1 Thessalonians", ["1 thessalonians", "first thessalonians", "1st thessalonians", "one thessalonians", "i thessalonians", "1 thess", "1 thes"]],
  ["2 Thessalonians", ["2 thessalonians", "second thessalonians", "2nd thessalonians", "two thessalonians", "ii thessalonians", "2 thess", "2 thes"]],
  ["1 Timothy", ["1 timothy", "first timothy", "1st timothy", "one timothy", "i timothy", "1 tim", "1tim"]],
  ["2 Timothy", ["2 timothy", "second timothy", "2nd timothy", "two timothy", "ii timothy", "2 tim", "2tim"]],
  ["Titus", ["titus", "tit"]],
  ["Philemon", ["philemon", "philem", "phlm", "phm"]],
  ["Hebrews", ["hebrews", "heb"]],
  ["James", ["james", "jas", "jm"]],
  ["1 Peter", ["1 peter", "first peter", "1st peter", "one peter", "i peter", "1 pet", "1pet"]],
  ["2 Peter", ["2 peter", "second peter", "2nd peter", "two peter", "ii peter", "2 pet", "2pet"]],
  ["1 John", ["1 john", "first john", "1st john", "one john", "i john", "1 jn"]],
  ["2 John", ["2 john", "second john", "2nd john", "two john", "ii john", "2 jn"]],
  ["3 John", ["3 john", "third john", "3rd john", "three john", "iii john", "3 jn"]],
  ["Jude", ["jude", "jud"]],
  ["Revelation", ["revelation", "revelations", "rev", "apoc"]],
];

const VARIANT_TO_BOOK = new Map<string, string>();
for (const [canonical, variants] of RAW_BOOKS) {
  for (const v of variants) VARIANT_TO_BOOK.set(v, canonical);
  VARIANT_TO_BOOK.set(canonical.toLowerCase(), canonical);
  // Auto-derive spaceless variants for numbered books ("1john", "2cor",
  // "1thess", "1john", etc.) — testers naturally type without a space and
  // the parser used to silently return null on those forms.
  for (const v of variants) {
    if (/^[123]\s+\S/.test(v)) VARIANT_TO_BOOK.set(v.replace(/\s+/g, ""), canonical);
  }
}

// Longest first, so "1 corinthians" is matched before "1 co".
const BOOK_VARIANTS = Array.from(VARIANT_TO_BOOK.keys()).sort((a, b) => b.length - a.length);
const BOOK_PATTERN = BOOK_VARIANTS.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");

// --- Number handling --------------------------------------------------------
const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, first: 1, two: 2, second: 2, three: 3, third: 3,
  four: 4, fourth: 4, five: 5, fifth: 5, six: 6, sixth: 6, seven: 7, seventh: 7,
  eight: 8, eighth: 8, nine: 9, ninth: 9, ten: 10, tenth: 10,
  eleven: 11, eleventh: 11, twelve: 12, twelfth: 12,
  thirteen: 13, thirteenth: 13, fourteen: 14, fourteenth: 14,
  fifteen: 15, fifteenth: 15, sixteen: 16, sixteenth: 16,
  seventeen: 17, seventeenth: 17, eighteen: 18, eighteenth: 18,
  nineteen: 19, nineteenth: 19,
  twenty: 20, twentieth: 20, thirty: 30, thirtieth: 30,
  forty: 40, fortieth: 40, fifty: 50, fiftieth: 50,
  sixty: 60, sixtieth: 60, seventy: 70, seventieth: 70,
  eighty: 80, eightieth: 80, ninety: 90, ninetieth: 90,
  hundred: 100, hundredth: 100,
};

/** Convert phrases like "one hundred nineteen" → 119. Returns NaN if uncertain. */
export function wordsToNumber(phrase: string): number {
  const words = phrase.toLowerCase().trim().split(/[\s-]+/);
  if (words.length === 0) return NaN;

  let total = 0;
  let current = 0;
  for (const w of words) {
    const n = NUMBER_WORDS[w];
    if (n === undefined) {
      // Also handle digits mixed in
      const asNum = Number(w);
      if (!Number.isNaN(asNum) && Number.isInteger(asNum)) { current += asNum; continue; }
      return NaN;
    }
    if (n === 100) {
      current = (current || 1) * 100;
    } else if (n >= 20 && n < 100) {
      current += n;
    } else {
      current += n;
    }
  }
  total += current;
  return total;
}

// --- Spoken numeral chunk recognizer ----------------------------------------
const NUM_TOKEN_PATTERN =
  "(?:\\d+|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)_(?:one|two|three|four|five|six|seven|eight|nine)|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth|fortieth|fiftieth|sixtieth|seventieth|eightieth|ninetieth|hundredth)";
// A single number "chunk" — one token, or a sequence joined by whitespace
// (e.g. "one hundred nineteen"). Range separators do NOT appear inside a chunk.
const NUM_CHUNK = `(${NUM_TOKEN_PATTERN}(?:\\s+${NUM_TOKEN_PATTERN}){0,5})`;
// A single-token number chunk — no whitespace-joined compounds. Used for
// chapter positions where a bare space separator is used to reach the verse,
// so we don't over-consume ("John three sixteen" mustn't collapse to "19").
// Excludes "hundred"/"thousand" so compound numbers ("one hundred nineteen")
// aren't split into a false chapter/verse pair.
const NUM_ATOM_PATTERN =
  "(?:\\d+|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)_(?:one|two|three|four|five|six|seven|eight|nine)|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth|fortieth|fiftieth|sixtieth|seventieth|eightieth|ninetieth|hundredth)";
const NUM_SINGLE = `(${NUM_ATOM_PATTERN})`;

function chunkToNum(raw: string): number {
  const s = raw.trim().replace(/_/g, " "); // un-fuse compounds for wordsToNumber
  const asDigits = Number(s);
  if (!Number.isNaN(asDigits) && Number.isInteger(asDigits)) return asDigits;
  return wordsToNumber(s);
}

function normalize(text: string): string {
  let s = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[,.;!?]/g, " ");

  // Fuse compound word numerals with an underscore so "twenty-eight" stays
  // atomic during pattern matching (won't be split by range separators or
  // chapter/verse separators). Only touches known tens-ones combos.
  s = s.replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)-(one|two|three|four|five|six|seven|eight|nine)\b/g, "$1_$2");
  // R2: also fuse space-separated compound spoken numbers ("twenty three" →
  // "twenty_three") so "Psalm twenty three" parses as a single chapter atom
  // (23) via book_ch, not chapter 20 verse 3 via book_ch_space_verse.
  s = s.replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\s+(one|two|three|four|five|six|seven|eight|nine)\b/g, "$1_$2");

  // Explicitize digit ranges so "3:16-17" doesn't fight NUM_CHUNK's greedy hyphen.
  s = s.replace(/(\d+)\s*[-–—]\s*(\d+)/g, "$1 to $2");
  // Spoken "dash" / "until" between number words → canonical " to "
  s = s.replace(/\s+(dash|until)\s+/g, " to ");

  return s.replace(/\s+/g, " ").trim();
}

// --- Public API -------------------------------------------------------------
export type ParsedReference = {
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
  /** Set only for cross-chapter ranges like "John 3:16-4:3". Undefined for single-chapter refs. */
  chapterEnd?: number;
  confidence: number; // 0-100
  matchedText: string;
  needsSemanticFallback: boolean;
  /** Character offset (start inclusive, end exclusive) in the normalized text. */
  start?: number;
  end?: number;
};

import { maxChapterFor } from "./bible-max-chapters";

const SINGLE_CHAPTER_BOOKS = new Set(["Obadiah", "Philemon", "2 John", "3 John", "Jude"]);

/**
 * Y6: reject parses where chapter is <=0 or exceeds MAX_CHAPTERS_FOR_BOOK.
 * Returns false if the (book, chapter) pair is impossible.
 */
function isValidChapter(book: string, chapter: number): boolean {
  if (!Number.isFinite(chapter) || chapter <= 0) return false;
  const max = maxChapterFor(book);
  if (typeof max === "number" && chapter > max) return false;
  return true;
}

// Pattern order matters — most specific first.
// Group 1: book (from BOOK_PATTERN), Group 2/3/... numbers.
const PATTERNS: { name: string; regex: RegExp; parse: (m: RegExpExecArray) => ParsedReference | null }[] = [
  // "SingleChapterBook verse N"
  {
    name: "single_chapter_book_verse",
    regex: new RegExp(`\\b(obadiah|philemon|2 john|3 john|second john|third john|jude)\\s+(?:verse\\s+)?${NUM_CHUNK}\\b`, "gi"),
    parse: (m) => {
      const bookKey = m[1].toLowerCase().replace(/\s+/g, " ");
      const book = VARIANT_TO_BOOK.get(bookKey);
      const verse = chunkToNum(m[2]);
      if (!book || !isFinite(verse)) return null;
      return { book, chapter: 1, verseStart: verse, verseEnd: verse, confidence: 94, matchedText: m[0], needsSemanticFallback: false };
    },
  },
  // Inverted: "verses N to N of Book C" / "verse N of Book C"
  {
    name: "verses_of_book_ch",
    regex: new RegExp(
      `\\bverses?\\s+${NUM_CHUNK}\\s*(?:to|through|thru|-|–|—)\\s*${NUM_CHUNK}\\s+of\\s+(${BOOK_PATTERN})\\s+(?:chapter\\s+)?${NUM_CHUNK}\\b`,
      "gi"
    ),
    parse: (m) => {
      const vStart = chunkToNum(m[1]);
      const vEnd = chunkToNum(m[2]);
      const bookKey = m[3].toLowerCase().replace(/\s+/g, " ");
      const book = VARIANT_TO_BOOK.get(bookKey);
      const chapter = chunkToNum(m[4]);
      if (!book || !isValidChapter(book, chapter) || !isFinite(vStart) || !isFinite(vEnd)) return null;
      return { book, chapter, verseStart: vStart, verseEnd: vEnd, confidence: 94, matchedText: m[0], needsSemanticFallback: false };
    },
  },
  // Y7: Inverted singular — "verse N of Book chapter C"
  {
    name: "verse_of_book_ch",
    regex: new RegExp(
      `\\bverse\\s+${NUM_CHUNK}\\s+of\\s+(${BOOK_PATTERN})\\s+(?:chapter\\s+)?${NUM_CHUNK}\\b`,
      "gi"
    ),
    parse: (m) => {
      const verse = chunkToNum(m[1]);
      const bookKey = m[2].toLowerCase().replace(/\s+/g, " ");
      const book = VARIANT_TO_BOOK.get(bookKey);
      const chapter = chunkToNum(m[3]);
      if (!book || !isValidChapter(book, chapter) || !isFinite(verse) || verse <= 0) return null;
      return { book, chapter, verseStart: verse, verseEnd: verse, confidence: 94, matchedText: m[0], needsSemanticFallback: false };
    },
  },
  // Cross-chapter range: "Book C:V - C:V" (only supports colon form to stay unambiguous)
  {
    name: "book_cross_chapter_range",
    regex: new RegExp(
      `\\b(${BOOK_PATTERN})\\s+(?:chapter\\s+)?${NUM_CHUNK}\\s*:\\s*${NUM_CHUNK}\\s*(?:to|through|thru|-|–|—)\\s*${NUM_CHUNK}\\s*:\\s*${NUM_CHUNK}\\b`,
      "gi"
    ),
    parse: (m) => {
      const bookKey = m[1].toLowerCase().replace(/\s+/g, " ");
      const book = VARIANT_TO_BOOK.get(bookKey);
      const chStart = chunkToNum(m[2]);
      const vStart = chunkToNum(m[3]);
      const chEnd = chunkToNum(m[4]);
      const vEnd = chunkToNum(m[5]);
      if (!book || !isValidChapter(book, chStart) || !isValidChapter(book, chEnd) || !isFinite(vStart) || !isFinite(vEnd)) return null;
      if (chEnd < chStart) return null;
      return { book, chapter: chStart, verseStart: vStart, chapterEnd: chEnd, verseEnd: vEnd, confidence: 96, matchedText: m[0], needsSemanticFallback: false };
    },
  },
  // "Book Chapter [colon|verse|:|space|from verse] Verse [to|dash|through|to verse] Verse"
  {
    name: "book_ch_v_to_v",
    regex: new RegExp(
      `\\b(${BOOK_PATTERN})\\s+(?:chapter\\s+)?${NUM_CHUNK}\\s*(?::|,\\s*|\\s+verses?\\s+|\\s+from\\s+verses?\\s+|\\s+)\\s*${NUM_CHUNK}\\s*(?:to|through|thru|-|–|—|to\\s+verses?)\\s*${NUM_CHUNK}\\b`,
      "gi"
    ),
    parse: (m) => {
      const bookKey = m[1].toLowerCase().replace(/\s+/g, " ");
      const book = VARIANT_TO_BOOK.get(bookKey);
      const chapter = chunkToNum(m[2]);
      const vStart = chunkToNum(m[3]);
      const vEnd = chunkToNum(m[4]);
      if (!book || !isValidChapter(book, chapter) || !isFinite(vStart) || !isFinite(vEnd)) return null;
      return { book, chapter, verseStart: vStart, verseEnd: vEnd, confidence: 95, matchedText: m[0], needsSemanticFallback: false };
    },
  },
  // "Book Chapter:Verse" (colon/comma-separated, digit-friendly). Allow
  // zero whitespace between book and chapter so "1john1:1" / "psalm23:1"
  // parse — a lot of testers type without spaces on mobile / when in a hurry.
  {
    name: "book_ch_colon_verse",
    regex: new RegExp(
      `\\b(${BOOK_PATTERN})\\s*(?:chapter\\s+)?${NUM_CHUNK}\\s*(?::|\\s+verses?\\s+|,\\s*)\\s*${NUM_CHUNK}\\b(?!\\s*(?:to|through|thru|-|–|—))`,
      "gi"
    ),
    parse: (m) => {
      const bookKey = m[1].toLowerCase().replace(/\s+/g, " ");
      const book = VARIANT_TO_BOOK.get(bookKey);
      const chapter = chunkToNum(m[2]);
      const verse = chunkToNum(m[3]);
      if (!book || !isFinite(chapter) || !isFinite(verse)) return null;
      // Chapter-only books (Obadiah, Philemon, 2/3 John, Jude) — the "verse" is actually a chapter number if we mis-detect
      if (SINGLE_CHAPTER_BOOKS.has(book)) {
        return { book, chapter: 1, verseStart: chapter, verseEnd: chapter, confidence: 90, matchedText: m[0], needsSemanticFallback: false };
      }
      if (!isValidChapter(book, chapter)) return null;
      return { book, chapter, verseStart: verse, verseEnd: verse, confidence: 92, matchedText: m[0], needsSemanticFallback: false };
    },
  },
  // "Book Chapter Verse" — bare-space separator, chapter must be single token
  // so "John three sixteen" resolves to John 3:16 (not John 19).
  {
    name: "book_ch_space_verse",
    // Allow zero-whitespace between book and chapter ("1john1 1", "psalm23 1")
    // to match how testers type on mobile / in a hurry.
    regex: new RegExp(
      `\\b(${BOOK_PATTERN})\\s*(?:chapter\\s+)?${NUM_SINGLE}\\s+${NUM_SINGLE}\\b(?!\\s*(?:to\\b|through\\b|thru\\b|-|–|—|hundred\\b))`,
      "gi"
    ),
    parse: (m) => {
      const bookKey = m[1].toLowerCase().replace(/\s+/g, " ");
      const book = VARIANT_TO_BOOK.get(bookKey);
      const chapter = chunkToNum(m[2]);
      const verse = chunkToNum(m[3]);
      if (!book || !isFinite(chapter) || !isFinite(verse)) return null;
      if (SINGLE_CHAPTER_BOOKS.has(book)) {
        return { book, chapter: 1, verseStart: chapter, verseEnd: chapter, confidence: 85, matchedText: m[0], needsSemanticFallback: false };
      }
      if (!isValidChapter(book, chapter)) return null;
      return { book, chapter, verseStart: verse, verseEnd: verse, confidence: 85, matchedText: m[0], needsSemanticFallback: false };
    },
  },
  // "Book Chapter" (whole chapter, no verse specified) — lower confidence
  {
    name: "book_ch",
    regex: new RegExp(`\\b(${BOOK_PATTERN})\\s+(?:chapter\\s+)?${NUM_CHUNK}\\b(?!\\s*(?::|verse|,|\\s+\\d))`, "gi"),
    parse: (m) => {
      const bookKey = m[1].toLowerCase().replace(/\s+/g, " ");
      const book = VARIANT_TO_BOOK.get(bookKey);
      const chapter = chunkToNum(m[2]);
      if (!book || !isFinite(chapter)) return null;
      if (SINGLE_CHAPTER_BOOKS.has(book)) {
        return { book, chapter: 1, verseStart: chapter, verseEnd: chapter, confidence: 78, matchedText: m[0], needsSemanticFallback: false };
      }
      // Y6: reject chapter <=0 or > MAX_CHAPTERS_FOR_BOOK.
      if (!isValidChapter(book, chapter)) return null;
      return { book, chapter, verseStart: 1, verseEnd: 1, confidence: 72, matchedText: m[0], needsSemanticFallback: false };
    },
  },
];

/** Parse a transcript segment for Bible references. Returns all matches. */
// Hard cap on parser input length. Every regex here is bounded ({0,5}
// quantifiers, no nested alternation over shared prefixes), so no
// exponential blowup — but polynomial O(n·m) on very long strings is still
// avoidable. 4 KB is generous for any realistic transcript segment or
// user-typed reference; beyond that we truncate.
const MAX_PARSE_INPUT_BYTES = 4096;

export function parseReferences(rawText: string): ParsedReference[] {
  if (typeof rawText !== "string" || rawText.length === 0) return [];
  const capped = rawText.length > MAX_PARSE_INPUT_BYTES
    ? rawText.slice(0, MAX_PARSE_INPUT_BYTES)
    : rawText;
  const text = normalize(capped);
  const found: ParsedReference[] = [];
  const seenSpans = new Set<string>();

  for (const pat of PATTERNS) {
    pat.regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pat.regex.exec(text)) !== null) {
      const start = m.index;
      const end = m.index + m[0].length;
      const span = `${start}-${end}`;
      if (seenSpans.has(span)) continue;
      // Skip if this span overlaps a higher-confidence earlier find.
      // Compare intervals directly — using indexOf on matchedText breaks when
      // the same phrase appears twice (Y4 in the Priority-1 review).
      const overlap = found.some((f) =>
        f.start !== undefined && f.end !== undefined && f.start < end && f.end > start
      );
      if (overlap) continue;
      const ref = pat.parse(m);
      if (ref) {
        ref.start = start;
        ref.end = end;
        found.push(ref);
        seenSpans.add(span);
      }
    }
  }

  // Mark low-confidence for semantic fallback
  for (const f of found) if (f.confidence < 80) f.needsSemanticFallback = true;

  return found;
}

/** Exported for tests / semantic fallback callers. */
export function knownBook(name: string): string | undefined {
  return VARIANT_TO_BOOK.get(normalize(name));
}

/**
 * Single-shot parser: returns the highest-confidence reference or null.
 *
 * Whole-chapter matches (no verse specified, e.g. "Ps 23") return
 * verseStart=1 and verseEnd=null. Verse-specified matches return equal
 * start/end for a single verse and start<end for ranges.
 */
export type SimpleReference = {
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number | null;
  /** Populated only for cross-chapter ranges (e.g. John 3:16-4:3). */
  chapterEnd?: number;
};
export function parseReference(text: string): SimpleReference | null {
  if (!text || !text.trim()) return null;
  const refs = parseReferences(text);
  if (refs.length === 0) return null;
  // Highest confidence first
  refs.sort((a, b) => b.confidence - a.confidence);
  const r = refs[0];
  // Detect whole-chapter matches: current implementation encodes those as
  // verseStart=1, verseEnd=1 with confidence <=78 in the "book_ch" branch.
  // We disambiguate by checking whether the matched text contains a verse
  // marker (":" or "verse"/"verses" or a second number after the chapter).
  const raw = text.toLowerCase();
  const hasVerseMarker = /:|\bverses?\b|\bfrom\s+verse/.test(raw);
  const digitCount = (raw.match(/\d+/g) || []).length;
  const wholeChapter =
    (!hasVerseMarker && digitCount <= 1 && r.verseStart === 1 && r.verseEnd === 1 && r.chapterEnd === undefined) ||
    // Psalms guard: "Psalm 23" / "Psalm twenty three" without any ":" or
    // "verse" marker should always be a whole-chapter reference, not v1.
    (r.book === "Psalms" && !hasVerseMarker && r.chapterEnd === undefined);
  const out: SimpleReference = {
    book: r.book,
    chapter: r.chapter,
    verseStart: r.verseStart,
    verseEnd: wholeChapter ? null : r.verseEnd,
  };
  if (r.chapterEnd !== undefined) out.chapterEnd = r.chapterEnd;
  return out;
}

/**
 * Cheap heuristic: does this look like a Bible reference (vs a phrase)?
 * Used by the BibleMode input to pick between /api/bible/lookup and
 * /api/bible/search. Refined by parseReference() when uncertain.
 */
export function isProbablyReference(s: string): boolean {
  if (!s || typeof s !== "string") return false;
  const t = s.trim();
  if (!t) return false;
  // Contains "chapter:verse"
  if (/\d+\s*:\s*\d+/.test(t)) return true;
  // Book + chapter (e.g. "Psalm 23", "1 Cor 13", "III John 1")
  if (/^\s*(1|2|3|I{1,3}|1st|2nd|3rd)?\s*[A-Za-z][A-Za-z\s\.]{1,}\s+\d+\b/.test(t)) {
    // Confirm with parser
    try { return parseReference(t) !== null; } catch { return true; }
  }
  // Fallback to the parser for edge cases
  try { return parseReference(t) !== null; } catch { return false; }
}
