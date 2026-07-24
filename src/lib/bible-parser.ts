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
  ["Acts", ["acts", "act", "acts of the apostles", "acts of the apostle", "the acts of the apostles", "acts of apostle", "acts of apostles"]],
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
  zero: 0, oh: 0, one: 1, first: 1, two: 2, second: 2, three: 3, third: 3,
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

  // Digit-by-digit reading — "Psalm one oh seven", "one zero seven" — common
  // for 3-digit chapter numbers (Psalms go up to 150) read out like a phone
  // number rather than as a compound ("one hundred seven"). Detected when
  // every word is a bare single digit (0-9, via "zero"/"oh"/"one".."nine" or
  // a literal digit character) with 2+ words and no ten/hundred word present
  // — otherwise this is ordinary compound-number speech and falls through
  // to the summing logic below unchanged.
  if (words.length >= 2) {
    const digits: number[] = [];
    let allSingleDigits = true;
    for (const w of words) {
      const n = NUMBER_WORDS[w];
      if (n !== undefined && n <= 9) { digits.push(n); continue; }
      const asNum = Number(w);
      if (!Number.isNaN(asNum) && Number.isInteger(asNum) && asNum >= 0 && asNum <= 9) { digits.push(asNum); continue; }
      allSingleDigits = false;
      break;
    }
    if (allSingleDigits && digits.length === words.length) {
      return Number(digits.join(""));
    }
  }

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
// Single bare digit words (0-9) — used to build the 3-digit "phone number
// style" fusion below (e.g. "one oh seven" -> "one_oh_seven" -> 107).
const BARE_DIGIT_WORD = "(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)";
const NUM_TOKEN_PATTERN =
  `(?:\\d+|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)_(?:one|two|three|four|five|six|seven|eight|nine)|${BARE_DIGIT_WORD}_${BARE_DIGIT_WORD}_${BARE_DIGIT_WORD}|zero|oh|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth|fortieth|fiftieth|sixtieth|seventieth|eightieth|ninetieth|hundredth)`;
// A single number "chunk" — one token, or a sequence joined by whitespace
// (e.g. "one hundred nineteen"). Range separators do NOT appear inside a chunk.
const NUM_CHUNK = `(${NUM_TOKEN_PATTERN}(?:\\s+${NUM_TOKEN_PATTERN}){0,5})`;
// A single-token number chunk — no whitespace-joined compounds. Used for
// chapter positions where a bare space separator is used to reach the verse,
// so we don't over-consume ("John three sixteen" mustn't collapse to "19").
// Excludes "hundred"/"thousand" so compound numbers ("one hundred nineteen")
// aren't split into a false chapter/verse pair. Includes the 3-digit fused
// form above so it counts as ONE atom, not chapter+verse — a run of exactly
// 3 bare digit words is overwhelmingly a phone-number-style chapter reading
// (e.g. Psalm 107), never a real "chapter X verse Y" (that's always 2 tokens
// in natural speech, or said with an explicit "verse").
const NUM_ATOM_PATTERN =
  `(?:\\d+|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)_(?:one|two|three|four|five|six|seven|eight|nine)|${BARE_DIGIT_WORD}_${BARE_DIGIT_WORD}_${BARE_DIGIT_WORD}|zero|oh|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth|fortieth|fiftieth|sixtieth|seventieth|eightieth|ninetieth|hundredth)`;
const NUM_SINGLE = `(${NUM_ATOM_PATTERN})`;

function chunkToNum(raw: string): number {
  const s = raw.trim().replace(/_/g, " "); // un-fuse compounds for wordsToNumber
  const asDigits = Number(s);
  if (!Number.isNaN(asDigits) && Number.isInteger(asDigits)) return asDigits;
  return wordsToNumber(s);
}

// Accent / ASR homophone repair for spoken numbers. The dominant real-world
// failure (reported from live African-preacher services) is TH-fronting:
// Deepgram transcribes "three" as "tree", "third" as "tird", "thirty" as
// "tirty", etc., because the /θ/ sound is realised as /t/. There are also a
// few common English homophones ("for"→four, "ate"→eight) that are far too
// risky to remap globally, so those are handled ONLY inside a reference shape
// by the patterns, never here. This pass repairs only the TH-fronted number
// words, each with a guard against the obvious non-number meaning.
function repairNumberHomophones(s: string): string {
  // Only the guarded "tree" rule matters in practice; apply the TH-fronted
  // set. The list is intentionally conservative — every entry is a word that
  // is virtually never a real English word in a Bible-reference context.
  s = s.replace(/\btree\b(?!\s+of\b)/g, "three");
  s = s.replace(/\btird\b/g, "third");
  s = s.replace(/\btirteen(th)?\b/g, (m) => (m.endsWith("th") ? "thirteenth" : "thirteen"));
  s = s.replace(/\btirty\b/g, "thirty");
  s = s.replace(/\btirtieth\b/g, "thirtieth");
  s = s.replace(/\btousand\b/g, "thousand");
  return s;
}

/**
 * Public helper — extract the list of word-level auto-corrections the parser
 * would apply to a raw transcript segment. Used by the audio bridge to
 * forward "the AI initially heard X, then contextually corrected to Y"
 * signals to the client so the transcript panel can visibly show the fix
 * in real time (yellow highlight, fade). Case-insensitive match, but the
 * original casing from the transcript is preserved in `original`.
 *
 * Currently surfaces:
 *   - TH-fronting number repairs (tree→three, tird→third, tirty→thirty,
 *     tirteen→thirteen, tousand→thousand, etc.)
 *
 * Future extensions (fuzzy book match, whisper-canonical diff) plug in the
 * same shape so the client render path stays identical.
 */
export type TranscriptCorrection = { original: string; corrected: string };
export function extractCorrections(rawText: string): TranscriptCorrection[] {
  if (!rawText) return [];
  const out: TranscriptCorrection[] = [];
  const seen = new Set<string>(); // dedupe on `${lower(original)}→${lower(corrected)}`
  const pairs: [RegExp, string | ((m: string) => string)][] = [
    [/\btree\b(?!\s+of\b)/gi, "three"],
    [/\btird\b/gi, "third"],
    [/\btirteen(th)?\b/gi, (m: string) => (m.toLowerCase().endsWith("th") ? "thirteenth" : "thirteen")],
    [/\btirty\b/gi, "thirty"],
    [/\btirtieth\b/gi, "thirtieth"],
    [/\btousand\b/gi, "thousand"],
  ];
  for (const [re, repl] of pairs) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(rawText)) !== null) {
      const original = m[0];
      const corrected = typeof repl === "function" ? repl(original) : repl;
      const key = `${original.toLowerCase()}→${corrected.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ original, corrected });
    }
  }
  return out;
}

function normalize(text: string): string {
  let s = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[,.;!?]/g, " ");

  // Accent/ASR number-homophone repair (TH-fronting: tree→three, tirty→thirty…)
  // BEFORE any number pattern runs, so "john tree sixteen" parses as John 3:16.
  s = repairNumberHomophones(s);

  // Auto-caption/ASR output sometimes fuses "verse"/"chapter" directly onto
  // the following digits with zero space ("verse1", "verse20", "chapter3")
  // instead of "verse 1" — every book_ch/verse pattern in this file requires
  // \s+ between the word and the number, so a fused form silently failed to
  // match at all. Split it back apart before anything else runs.
  s = s.replace(/\b(verses?|chapters?)(\d+)\b/g, "$1 $2");

  // Fuse compound word numerals with an underscore so "twenty-eight" stays
  // atomic during pattern matching (won't be split by range separators or
  // chapter/verse separators). Only touches known tens-ones combos.
  s = s.replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)-(one|two|three|four|five|six|seven|eight|nine)\b/g, "$1_$2");
  // R2: also fuse space-separated compound spoken numbers ("twenty three" →
  // "twenty_three") so "Psalm twenty three" parses as a single chapter atom
  // (23) via book_ch, not chapter 20 verse 3 via book_ch_space_verse.
  s = s.replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\s+(one|two|three|four|five|six|seven|eight|nine)\b/g, "$1_$2");
  // Fuse a RUN OF EXACTLY 3 bare single-digit words ("one oh seven", "one
  // zero seven") into one atom the same way — phone-number-style reading of
  // a 3-digit chapter number (Psalms go up to 150), never a real "chapter X
  // verse Y" (that's 2 tokens, or said with an explicit "verse"). Must run
  // BEFORE book_ch_space_verse's 2-atom chapter+verse pattern gets a chance
  // to grab the first two of the three digits and strand the third.
  s = s.replace(
    /\b(zero|oh|one|two|three|four|five|six|seven|eight|nine)\s+(zero|oh|one|two|three|four|five|six|seven|eight|nine)\s+(zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/g,
    "$1_$2_$3",
  );

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
  /** Set when the utterance is an explicit spoken navigation command ("from
   * verse 13", "verse 7") rather than an incidental reference mention —
   * callers use this to bypass anti-spam rate limits that exist to guard
   * against passive/incidental mentions, not deliberate operator commands. */
  isNavigationCommand?: boolean;
};

import { maxChapterFor } from "./bible-max-chapters";

const SINGLE_CHAPTER_BOOKS = new Set(["Obadiah", "Philemon", "2 John", "3 John", "Jude"]);

/**
 * Y6: reject parses where chapter is <=0 or exceeds MAX_CHAPTERS_FOR_BOOK.
 * Returns false if the (book, chapter) pair is impossible.
 */
export function isValidChapter(book: string, chapter: number): boolean {
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
  // "Book Chapter from [verse] Verse" — single verse start, no end range
  // ("Luke 11 from 13", "Luke chapter 11 from verse 13"). Same single-verse
  // semantics as book_ch_space_verse, just spoken with an explicit "from".
  // Must exclude a trailing range tail so book_ch_v_to_v (which requires
  // "from verse N to M") keeps priority when a range is actually spoken.
  {
    name: "book_ch_from_verse",
    regex: new RegExp(
      `\\b(${BOOK_PATTERN})\\s+(?:chapter\\s+)?${NUM_CHUNK}\\s+from\\s+(?:verses?\\s+)?${NUM_CHUNK}\\b(?!\\s*(?:to\\b|through\\b|thru\\b|-|–|—))`,
      "gi"
    ),
    parse: (m) => {
      const bookKey = m[1].toLowerCase().replace(/\s+/g, " ");
      const book = VARIANT_TO_BOOK.get(bookKey);
      const chapter = chunkToNum(m[2]);
      const verse = chunkToNum(m[3]);
      if (!book || !isFinite(chapter) || !isFinite(verse)) return null;
      if (SINGLE_CHAPTER_BOOKS.has(book)) {
        return { book, chapter: 1, verseStart: chapter, verseEnd: chapter, confidence: 90, matchedText: m[0], needsSemanticFallback: false, isNavigationCommand: true };
      }
      if (!isValidChapter(book, chapter)) return null;
      return { book, chapter, verseStart: verse, verseEnd: verse, confidence: 90, matchedText: m[0], needsSemanticFallback: false, isNavigationCommand: true };
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
  // Fuzzy/phonetic book fallback — last resort, lowest priority (only tried
  // when nothing above already claimed the span). Real transcripts show ASR
  // mishearing book names badly enough that they don't even fuzzy-match by
  // edit distance (e.g. "Hosea" heard as "OA") — this pattern exists for the
  // less extreme cases (near-miss pronunciations, accent-driven substitutions)
  // by reusing the SAME fuzzyBookMatch() used elsewhere for canonicalization,
  // now applied during live parsing too. Deliberately requires the STRONGER
  // "chapter:verse" or "chapter verse N" shape (two numbers, explicit
  // separator) — a bare "word chapter N" alone is too common in ordinary
  // speech to risk fuzzy-matching against arbitrary words.
  {
    name: "fuzzy_book_ch_verse",
    // The candidate group's optional second word must NOT be able to match
    // "chapter"/"verse" themselves — those greedily got absorbed into the
    // candidate before the literal `(?:chapter\s+)?` below ever got a
    // chance, so "ruthe chapter one verse two" tried to fuzzy-match against
    // "ruthe chapter" (never matches anything) instead of "ruthe" (which
    // would correctly fuzzy-match Ruth). Found by review — this was the
    // pattern's single most common target shape and it was missing it.
    regex: new RegExp(
      `\\b([a-z]+(?:\\s+(?!chapter\\b|verses?\\b)[a-z]+){0,1})\\s+(?:chapter\\s+)?${NUM_CHUNK}\\s*(?::|\\s+verses?\\s+|,\\s*)\\s*${NUM_CHUNK}\\b(?!\\s*(?:to\\b|through\\b|thru\\b|-|–|—))`,
      "gi",
    ),
    parse: (m) => {
      const candidate = m[1].toLowerCase().trim();
      // Skip candidates the exact matcher would have already caught — this
      // pattern is purely for near-misses, not a second path to the same hit.
      if (VARIANT_TO_BOOK.has(candidate)) return null;
      const book = fuzzyBookMatch(candidate);
      if (!book) return null;
      const chapter = chunkToNum(m[2]);
      const verse = chunkToNum(m[3]);
      if (!isFinite(chapter) || !isFinite(verse)) return null;
      if (SINGLE_CHAPTER_BOOKS.has(book)) {
        return { book, chapter: 1, verseStart: chapter, verseEnd: chapter, confidence: 55, matchedText: m[0], needsSemanticFallback: true };
      }
      if (!isValidChapter(book, chapter)) return null;
      return { book, chapter, verseStart: verse, verseEnd: verse, confidence: 55, matchedText: m[0], needsSemanticFallback: true };
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
  let capped = rawText.length > MAX_PARSE_INPUT_BYTES
    ? rawText.slice(0, MAX_PARSE_INPUT_BYTES)
    : rawText;
  // If the slice landed mid-surrogate-pair, trim the orphan high surrogate.
  // Downstream regex tolerates lone surrogates but the input is cleaner.
  if (capped.length > 0) {
    const last = capped.charCodeAt(capped.length - 1);
    if (last >= 0xD800 && last <= 0xDBFF) capped = capped.slice(0, -1);
  }
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

// Small edit-distance fuzzy fallback for book names — targets accented/
// mispronounced speech that Deepgram transcribes as a near-miss of a real
// book variant (e.g. "filippians" for "philippians", "ecclesiastes" heard
// as "ecclesiastis"). Only used when an EXACT variant match fails; capped
// tightly (distance 1 for short words, 2 for longer ones) so it can't drift
// into matching an unrelated book. This is deliberately a plain edit-distance
// check, not a trained model — a real phonetic/ML correction pipeline would
// need actual transcript samples from the specific speakers to train against
// (see conversation: happy to build that next if given real sample audio/
// transcripts to work from).
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array(n + 1);
  const curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

function fuzzyBookMatch(normalized: string): string | undefined {
  if (normalized.length < 4) return undefined; // too short to fuzz safely
  const maxDist = normalized.length <= 6 ? 1 : 2;
  let best: { canonical: string; dist: number } | null = null;
  for (const [variant, canonical] of VARIANT_TO_BOOK) {
    if (Math.abs(variant.length - normalized.length) > maxDist) continue;
    const dist = levenshtein(normalized, variant);
    if (dist <= maxDist && (!best || dist < best.dist)) best = { canonical, dist };
  }
  return best?.canonical;
}

/** Exported for tests / semantic fallback callers. */
export function knownBook(name: string): string | undefined {
  const normalized = normalize(name);
  return VARIANT_TO_BOOK.get(normalized) ?? fuzzyBookMatch(normalized);
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
  // Same fix as normalize(): auto-caption output sometimes fuses "verse"
  // directly onto the digits ("verse20") with no space, which \bverses?\b
  // below can't see (no word boundary between "verse" and a following
  // digit). Split it back apart here too — this disambiguation runs on its
  // own raw copy of the text, separate from the normalize() call inside
  // parseReferences() above, so it needs the same fix independently.
  const raw = text.toLowerCase().replace(/\b(verses?)(\d+)\b/g, "$1 $2");
  const hasVerseMarker = /:|\bverses?\b|\bfrom\s+verse/.test(raw);
  // BUG FIX: this used to only count literal digit characters (\d+), so a
  // naturally-spoken "Genesis one one" (chapter 1, verse 1 — no "verse"
  // word, no digits, no colon) had digitCount=0 and got misclassified as
  // "whole chapter" instead of specifically verse 1 — the exact case
  // reported as "verse 1 doesn't parse right." Now also counts recognized
  // number-WORDS, so a second spoken number (however it's said) is counted
  // the same as a literal digit.
  // Exclude "first"/"second"/"third" — these are almost always the ordinal
  // PREFIX of a book name ("First Corinthians", "Second Timothy", "Third
  // John"), not a real second spoken number. Counting them here was a
  // regression: "First Corinthians 13" got miscounted as digitCount=2
  // (the book's own "First" + "13") and wrongly fell out of the whole-
  // chapter branch, turning it into "verse 1" instead of the whole chapter.
  // A genuine "the first verse" phrasing is already caught by hasVerseMarker
  // above (\bverses?\b), so this exclusion doesn't reintroduce the original bug.
  const numberWordMatches = raw.match(/\b[a-z]+\b/g)?.filter((w) => w in NUMBER_WORDS && w !== "first" && w !== "second" && w !== "third") ?? [];
  const digitCount = (raw.match(/\d+/g) || []).length + numberWordMatches.length;
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

// Bare "verse N" mention with no book/chapter attached — e.g. "what does
// verse 11 say", "verse 7". Only meaningful when resolved against a chapter
// that's already active in the current service (the caller tracks that
// context; this module is stateless). Callers should only use this as a
// fallback when parseReferences() found nothing in the same text, since a
// full reference always takes priority over a bare verse number.
const BARE_VERSE_RE = new RegExp(`\\bverses?\\s+${NUM_CHUNK}\\b`, "i");
export function parseBareVerse(rawText: string): { verse: number; matchedText: string } | null {
  if (typeof rawText !== "string" || !rawText) return null;
  const text = normalize(rawText.slice(0, MAX_PARSE_INPUT_BYTES));
  const m = BARE_VERSE_RE.exec(text);
  if (!m) return null;
  const verse = chunkToNum(m[1]);
  if (!Number.isFinite(verse) || verse <= 0) return null;
  return { verse, matchedText: m[0] };
}

// "Book verse N" — a book name IS spoken but with no chapter number at all
// ("Acts of the Apostles verse 4"). Distinct from parseBareVerse (no book
// mentioned) — here the book is named explicitly but the chapter has to be
// inferred by the caller: same book as whatever's currently active → carry
// the chapter over; a different book → the caller should default to
// chapter 1 (mirrors the existing book-chapter-only default of verse 1).
// Only meaningful as a fallback when parseReferences() found nothing.
const BOOK_VERSE_ONLY_RE = new RegExp(
  `\\b(${BOOK_PATTERN})\\s+verses?\\s+${NUM_CHUNK}\\b(?!\\s*(?:to\\b|through\\b|thru\\b|-|–|—))`,
  "i",
);
export function parseBookVerseOnly(rawText: string): { book: string; verse: number; matchedText: string } | null {
  if (typeof rawText !== "string" || !rawText) return null;
  const text = normalize(rawText.slice(0, MAX_PARSE_INPUT_BYTES));
  const m = BOOK_VERSE_ONLY_RE.exec(text);
  if (!m) return null;
  const bookKey = m[1].toLowerCase().replace(/\s+/g, " ");
  const book = VARIANT_TO_BOOK.get(bookKey);
  const verse = chunkToNum(m[2]);
  if (!book || !Number.isFinite(verse) || verse <= 0) return null;
  return { book, verse, matchedText: m[0] };
}
