/**
 * Bible verse detection — comprehensive test corpus.
 *
 * Every case feeds a plain-text string into `parseReferences()` and expects
 * at least one detection matching the given book+chapter (+verse if set).
 * Covers all 66 books across seven format families (spoken-full, spoken-short,
 * abbreviated, conversational, partial, tricky, Deepgram/ASR variations).
 *
 * Run via `src/tests/bibleDetection/detectionTestRunner.ts`.
 */

export type Expected = {
  book: string;
  chapter: number;
  verse?: number;
};

export type TestCase = {
  input: string;
  expected: Expected;
  format:
    | "spoken_full"
    | "spoken_short"
    | "abbreviated"
    | "conversational"
    | "partial"
    | "tricky"
    | "deepgram";
};

// Canonical book list (matches `bible-parser.ts` RAW_BOOKS). Each entry:
// [canonical, [abbreviations], sampleChapter, sampleVerse, chapterWord, verseWord]
// The abbreviations list feeds the "abbreviated" format directly.
type BookSpec = {
  canonical: string;
  abbrevs: string[];
  ch: number;
  v: number;
  chapterWord: string;
  verseWord: string;
};

const BOOKS: BookSpec[] = [
  { canonical: "Genesis",        abbrevs: ["Gen", "Gn"],       ch: 1,  v: 1,  chapterWord: "one",       verseWord: "one" },
  { canonical: "Exodus",         abbrevs: ["Exod", "Exo"],     ch: 20, v: 3,  chapterWord: "twenty",    verseWord: "three" },
  { canonical: "Leviticus",      abbrevs: ["Lev", "Lv"],       ch: 19, v: 18, chapterWord: "nineteen",  verseWord: "eighteen" },
  { canonical: "Numbers",        abbrevs: ["Num", "Nm"],       ch: 6,  v: 24, chapterWord: "six",       verseWord: "twenty four" },
  { canonical: "Deuteronomy",    abbrevs: ["Deut", "Dt"],      ch: 6,  v: 5,  chapterWord: "six",       verseWord: "five" },
  { canonical: "Joshua",         abbrevs: ["Josh", "Jos"],     ch: 1,  v: 9,  chapterWord: "one",       verseWord: "nine" },
  { canonical: "Judges",         abbrevs: ["Judg", "Jdg"],     ch: 6,  v: 12, chapterWord: "six",       verseWord: "twelve" },
  { canonical: "Ruth",           abbrevs: ["Rut"],             ch: 1,  v: 16, chapterWord: "one",       verseWord: "sixteen" },
  { canonical: "1 Samuel",       abbrevs: ["1 Sam", "1Sam"],   ch: 17, v: 45, chapterWord: "seventeen", verseWord: "forty five" },
  { canonical: "2 Samuel",       abbrevs: ["2 Sam", "2Sam"],   ch: 7,  v: 12, chapterWord: "seven",     verseWord: "twelve" },
  { canonical: "1 Kings",        abbrevs: ["1 Kgs", "1Kgs"],   ch: 8,  v: 22, chapterWord: "eight",     verseWord: "twenty two" },
  { canonical: "2 Kings",        abbrevs: ["2 Kgs", "2Kgs"],   ch: 6,  v: 16, chapterWord: "six",       verseWord: "sixteen" },
  { canonical: "1 Chronicles",   abbrevs: ["1 Chr", "1 Ch"],   ch: 16, v: 11, chapterWord: "sixteen",   verseWord: "eleven" },
  { canonical: "2 Chronicles",   abbrevs: ["2 Chr", "2 Ch"],   ch: 7,  v: 14, chapterWord: "seven",     verseWord: "fourteen" },
  { canonical: "Ezra",           abbrevs: ["Ezr"],             ch: 7,  v: 10, chapterWord: "seven",     verseWord: "ten" },
  { canonical: "Nehemiah",       abbrevs: ["Neh"],             ch: 8,  v: 10, chapterWord: "eight",     verseWord: "ten" },
  { canonical: "Esther",         abbrevs: ["Esth", "Est"],     ch: 4,  v: 14, chapterWord: "four",      verseWord: "fourteen" },
  { canonical: "Job",            abbrevs: ["Jb"],              ch: 19, v: 25, chapterWord: "nineteen",  verseWord: "twenty five" },
  { canonical: "Psalms",         abbrevs: ["Ps", "Psa"],       ch: 23, v: 1,  chapterWord: "twenty three", verseWord: "one" },
  { canonical: "Proverbs",       abbrevs: ["Prov", "Prv"],     ch: 3,  v: 5,  chapterWord: "three",     verseWord: "five" },
  { canonical: "Ecclesiastes",   abbrevs: ["Eccl", "Ecc"],     ch: 3,  v: 1,  chapterWord: "three",     verseWord: "one" },
  { canonical: "Song of Solomon", abbrevs: ["SoS", "Song"],    ch: 2,  v: 4,  chapterWord: "two",       verseWord: "four" },
  { canonical: "Isaiah",         abbrevs: ["Isa"],             ch: 40, v: 31, chapterWord: "forty",     verseWord: "thirty one" },
  { canonical: "Jeremiah",       abbrevs: ["Jer"],             ch: 29, v: 11, chapterWord: "twenty nine", verseWord: "eleven" },
  { canonical: "Lamentations",   abbrevs: ["Lam"],             ch: 3,  v: 22, chapterWord: "three",     verseWord: "twenty two" },
  { canonical: "Ezekiel",        abbrevs: ["Ezek"],            ch: 36, v: 26, chapterWord: "thirty six", verseWord: "twenty six" },
  { canonical: "Daniel",         abbrevs: ["Dan", "Dn"],       ch: 3,  v: 17, chapterWord: "three",     verseWord: "seventeen" },
  { canonical: "Hosea",          abbrevs: ["Hos"],             ch: 6,  v: 6,  chapterWord: "six",       verseWord: "six" },
  { canonical: "Joel",           abbrevs: ["Jl"],              ch: 2,  v: 28, chapterWord: "two",       verseWord: "twenty eight" },
  { canonical: "Amos",           abbrevs: ["Amos"],            ch: 5,  v: 24, chapterWord: "five",      verseWord: "twenty four" },
  { canonical: "Obadiah",        abbrevs: ["Obad", "Ob"],      ch: 1,  v: 15, chapterWord: "one",       verseWord: "fifteen" },
  { canonical: "Jonah",          abbrevs: ["Jon"],             ch: 2,  v: 9,  chapterWord: "two",       verseWord: "nine" },
  { canonical: "Micah",          abbrevs: ["Mic", "Mi"],       ch: 6,  v: 8,  chapterWord: "six",       verseWord: "eight" },
  { canonical: "Nahum",          abbrevs: ["Nah", "Na"],       ch: 1,  v: 7,  chapterWord: "one",       verseWord: "seven" },
  { canonical: "Habakkuk",       abbrevs: ["Hab"],             ch: 2,  v: 4,  chapterWord: "two",       verseWord: "four" },
  { canonical: "Zephaniah",      abbrevs: ["Zeph", "Zep"],     ch: 3,  v: 17, chapterWord: "three",     verseWord: "seventeen" },
  { canonical: "Haggai",         abbrevs: ["Hag"],             ch: 2,  v: 9,  chapterWord: "two",       verseWord: "nine" },
  { canonical: "Zechariah",      abbrevs: ["Zech", "Zec"],     ch: 4,  v: 6,  chapterWord: "four",      verseWord: "six" },
  { canonical: "Malachi",        abbrevs: ["Mal"],             ch: 3,  v: 10, chapterWord: "three",     verseWord: "ten" },
  { canonical: "Matthew",        abbrevs: ["Matt", "Mt"],      ch: 5,  v: 3,  chapterWord: "five",      verseWord: "three" },
  { canonical: "Mark",           abbrevs: ["Mk", "Mr"],        ch: 10, v: 45, chapterWord: "ten",       verseWord: "forty five" },
  { canonical: "Luke",           abbrevs: ["Lk", "Lu"],        ch: 2,  v: 11, chapterWord: "two",       verseWord: "eleven" },
  { canonical: "John",           abbrevs: ["Jn", "Jhn"],       ch: 3,  v: 16, chapterWord: "three",     verseWord: "sixteen" },
  { canonical: "Acts",           abbrevs: ["Act"],             ch: 2,  v: 38, chapterWord: "two",       verseWord: "thirty eight" },
  { canonical: "Romans",         abbrevs: ["Rom", "Rm"],       ch: 8,  v: 28, chapterWord: "eight",     verseWord: "twenty eight" },
  { canonical: "1 Corinthians",  abbrevs: ["1 Cor", "1Cor"],   ch: 13, v: 4,  chapterWord: "thirteen",  verseWord: "four" },
  { canonical: "2 Corinthians",  abbrevs: ["2 Cor", "2Cor"],   ch: 5,  v: 17, chapterWord: "five",      verseWord: "seventeen" },
  { canonical: "Galatians",      abbrevs: ["Gal"],             ch: 5,  v: 22, chapterWord: "five",      verseWord: "twenty two" },
  { canonical: "Ephesians",      abbrevs: ["Eph"],             ch: 2,  v: 8,  chapterWord: "two",       verseWord: "eight" },
  { canonical: "Philippians",    abbrevs: ["Phil", "Php"],     ch: 4,  v: 13, chapterWord: "four",      verseWord: "thirteen" },
  { canonical: "Colossians",     abbrevs: ["Col"],             ch: 3,  v: 2,  chapterWord: "three",     verseWord: "two" },
  { canonical: "1 Thessalonians", abbrevs: ["1 Thess", "1 Thes"], ch: 5, v: 16, chapterWord: "five",   verseWord: "sixteen" },
  { canonical: "2 Thessalonians", abbrevs: ["2 Thess", "2 Thes"], ch: 3, v: 3,  chapterWord: "three",  verseWord: "three" },
  { canonical: "1 Timothy",      abbrevs: ["1 Tim", "1Tim"],   ch: 6,  v: 12, chapterWord: "six",       verseWord: "twelve" },
  { canonical: "2 Timothy",      abbrevs: ["2 Tim", "2Tim"],   ch: 3,  v: 16, chapterWord: "three",     verseWord: "sixteen" },
  { canonical: "Titus",          abbrevs: ["Tit"],             ch: 2,  v: 11, chapterWord: "two",       verseWord: "eleven" },
  { canonical: "Philemon",       abbrevs: ["Phlm", "Phm"],     ch: 1,  v: 6,  chapterWord: "one",       verseWord: "six" },
  { canonical: "Hebrews",        abbrevs: ["Heb"],             ch: 11, v: 1,  chapterWord: "eleven",    verseWord: "one" },
  { canonical: "James",          abbrevs: ["Jas", "Jm"],       ch: 1,  v: 5,  chapterWord: "one",       verseWord: "five" },
  { canonical: "1 Peter",        abbrevs: ["1 Pet", "1Pet"],   ch: 5,  v: 7,  chapterWord: "five",      verseWord: "seven" },
  { canonical: "2 Peter",        abbrevs: ["2 Pet", "2Pet"],   ch: 1,  v: 3,  chapterWord: "one",       verseWord: "three" },
  { canonical: "1 John",         abbrevs: ["1 Jn"],            ch: 4,  v: 8,  chapterWord: "four",      verseWord: "eight" },
  { canonical: "2 John",         abbrevs: ["2 Jn"],            ch: 1,  v: 6,  chapterWord: "one",       verseWord: "six" },
  { canonical: "3 John",         abbrevs: ["3 Jn"],            ch: 1,  v: 4,  chapterWord: "one",       verseWord: "four" },
  { canonical: "Jude",           abbrevs: ["Jud"],             ch: 1,  v: 3,  chapterWord: "one",       verseWord: "three" },
  { canonical: "Revelation",     abbrevs: ["Rev"],             ch: 21, v: 4,  chapterWord: "twenty one", verseWord: "four" },
];

// Chapter-only books (no chapter 2+). Their "partial" case is just "Book" or "Book 1"
// and their "spoken-full" verse case uses `verse N` (no chapter number).
const SINGLE_CHAPTER = new Set(["Obadiah", "Philemon", "2 John", "3 John", "Jude"]);

function push(cases: TestCase[], input: string, expected: Expected, format: TestCase["format"]) {
  cases.push({ input, expected, format });
}

function generate(): TestCase[] {
  const cases: TestCase[] = [];

  for (const b of BOOKS) {
    const isSingle = SINGLE_CHAPTER.has(b.canonical);
    const canon = b.canonical;

    // FORMAT 1 spoken_full — "chapter X verse Y"
    if (isSingle) {
      push(cases, `${canon} verse ${b.verseWord}`, { book: canon, chapter: 1, verse: b.v }, "spoken_full");
      push(cases, `${canon} verse ${b.v}`, { book: canon, chapter: 1, verse: b.v }, "spoken_full");
    } else {
      push(cases, `${canon} chapter ${b.chapterWord} verse ${b.verseWord}`, { book: canon, chapter: b.ch, verse: b.v }, "spoken_full");
      push(cases, `${canon} chapter ${b.ch} verse ${b.v}`, { book: canon, chapter: b.ch, verse: b.v }, "spoken_full");
    }

    // FORMAT 2 spoken_short — colon and space separators
    if (isSingle) {
      push(cases, `${canon} ${b.v}`, { book: canon, chapter: 1, verse: b.v }, "spoken_short");
    } else {
      push(cases, `${canon} ${b.ch}:${b.v}`, { book: canon, chapter: b.ch, verse: b.v }, "spoken_short");
      push(cases, `${canon} ${b.ch} ${b.v}`, { book: canon, chapter: b.ch, verse: b.v }, "spoken_short");
    }

    // FORMAT 3 abbreviated — each abbreviation
    for (const ab of b.abbrevs) {
      if (isSingle) {
        push(cases, `${ab} ${b.v}`, { book: canon, chapter: 1, verse: b.v }, "abbreviated");
      } else {
        push(cases, `${ab} ${b.ch}:${b.v}`, { book: canon, chapter: b.ch, verse: b.v }, "abbreviated");
      }
    }
    // Also trailing period on the abbreviation ("Gen.", "Ps.")
    if (b.abbrevs.length > 0) {
      const ab0 = b.abbrevs[0];
      if (isSingle) {
        push(cases, `${ab0}. ${b.v}`, { book: canon, chapter: 1, verse: b.v }, "abbreviated");
      } else {
        push(cases, `${ab0}. ${b.ch}:${b.v}`, { book: canon, chapter: b.ch, verse: b.v }, "abbreviated");
      }
    }

    // FORMAT 4 conversational — "Turn to...", "Let's read...", "The Bible says in..."
    if (isSingle) {
      push(cases, `Turn to ${canon}, verse ${b.v}`, { book: canon, chapter: 1, verse: b.v }, "conversational");
      push(cases, `As it says in ${canon} verse ${b.v}`, { book: canon, chapter: 1, verse: b.v }, "conversational");
    } else {
      push(cases, `Turn to ${canon} ${b.ch}, verse ${b.v}`, { book: canon, chapter: b.ch, verse: b.v }, "conversational");
      push(cases, `Let's read from ${canon} chapter ${b.ch}`, { book: canon, chapter: b.ch }, "conversational");
      push(cases, `As it says in ${canon} ${b.ch} verse ${b.v}`, { book: canon, chapter: b.ch, verse: b.v }, "conversational");
    }

    // FORMAT 5 partial — book+chapter, no verse
    if (!isSingle) {
      push(cases, `${canon} ${b.ch}`, { book: canon, chapter: b.ch }, "partial");
    }

    // FORMAT 7 deepgram — number words, mixed case, TH-fronting (some books)
    if (!isSingle) {
      // "verse forty six" style already tested; here add trailing period + mixed case
      push(cases, `${canon.toLowerCase()} ${b.ch}:${b.v}`, { book: canon, chapter: b.ch, verse: b.v }, "deepgram");
    }
  }

  // FORMAT 6 tricky — known collision & disambiguation cases
  const tricky: TestCase[] = [
    { input: "Song of Solomon 2:4", expected: { book: "Song of Solomon", chapter: 2, verse: 4 }, format: "tricky" },
    { input: "Song of Songs 2:4",   expected: { book: "Song of Solomon", chapter: 2, verse: 4 }, format: "tricky" },
    { input: "1 John 3:16",          expected: { book: "1 John", chapter: 3, verse: 16 }, format: "tricky" },
    { input: "First John 3:16",      expected: { book: "1 John", chapter: 3, verse: 16 }, format: "tricky" },
    { input: "One John 3 16",        expected: { book: "1 John", chapter: 3, verse: 16 }, format: "tricky" },
    { input: "I John 3:16",          expected: { book: "1 John", chapter: 3, verse: 16 }, format: "tricky" },
    { input: "2 Chronicles 7:14",    expected: { book: "2 Chronicles", chapter: 7, verse: 14 }, format: "tricky" },
    { input: "Second Chronicles 7:14", expected: { book: "2 Chronicles", chapter: 7, verse: 14 }, format: "tricky" },
    { input: "Psalm 46:10",          expected: { book: "Psalms", chapter: 46, verse: 10 }, format: "tricky" },
    { input: "Psalms 46:10",         expected: { book: "Psalms", chapter: 46, verse: 10 }, format: "tricky" },
    { input: "Philippians 4:13",     expected: { book: "Philippians", chapter: 4, verse: 13 }, format: "tricky" },
    { input: "Philemon 1:6",         expected: { book: "Philemon", chapter: 1, verse: 6 }, format: "tricky" },
    { input: "Jude 3",               expected: { book: "Jude", chapter: 1, verse: 3 }, format: "tricky" },
    { input: "Judges 6:12",          expected: { book: "Judges", chapter: 6, verse: 12 }, format: "tricky" },
    { input: "Acts 2:38",            expected: { book: "Acts", chapter: 2, verse: 38 }, format: "tricky" },
    { input: "Acts of the Apostles 2:38", expected: { book: "Acts", chapter: 2, verse: 38 }, format: "tricky" },
    { input: "Revelation 21:4",      expected: { book: "Revelation", chapter: 21, verse: 4 }, format: "tricky" },
    { input: "Revelations 21:4",     expected: { book: "Revelation", chapter: 21, verse: 4 }, format: "tricky" },
    { input: "III John 4",           expected: { book: "3 John", chapter: 1, verse: 4 }, format: "tricky" },
    { input: "II Corinthians 5:17",  expected: { book: "2 Corinthians", chapter: 5, verse: 17 }, format: "tricky" },
    { input: "Psalm 119:11",         expected: { book: "Psalms", chapter: 119, verse: 11 }, format: "tricky" },
    { input: "Psalm 23",             expected: { book: "Psalms", chapter: 23 }, format: "tricky" },
  ];
  cases.push(...tricky);

  // FORMAT 7 deepgram — mishearings (TH-fronting, chapter/verse mishears)
  const deepgram: TestCase[] = [
    { input: "John tree sixteen",           expected: { book: "John", chapter: 3, verse: 16 }, format: "deepgram" },
    { input: "Romans eight tirty",          expected: { book: "Romans", chapter: 8 }, format: "deepgram" },
    { input: "Matthew five tirteen",        expected: { book: "Matthew", chapter: 5, verse: 13 }, format: "deepgram" },
    { input: "Psalm 46 is 10",              expected: { book: "Psalms", chapter: 46, verse: 10 }, format: "deepgram" },
    { input: "John 3 and 16",               expected: { book: "John", chapter: 3, verse: 16 }, format: "deepgram" },
    { input: "Nehemiah 2 was 1",            expected: { book: "Nehemiah", chapter: 2, verse: 1 }, format: "deepgram" },
    { input: "Gen. 1:1",                    expected: { book: "Genesis", chapter: 1, verse: 1 }, format: "deepgram" },
    { input: "Ps. 46:10",                   expected: { book: "Psalms", chapter: 46, verse: 10 }, format: "deepgram" },
    { input: "PSALM 46:10",                 expected: { book: "Psalms", chapter: 46, verse: 10 }, format: "deepgram" },
    { input: "psalm 46:10",                 expected: { book: "Psalms", chapter: 46, verse: 10 }, format: "deepgram" },
    { input: "filippians four thirteen",    expected: { book: "Philippians", chapter: 4, verse: 13 }, format: "deepgram" },
    { input: "ecclesiastis 3:1",            expected: { book: "Ecclesiastes", chapter: 3, verse: 1 }, format: "deepgram" },
    { input: "corintians 13:4",             expected: { book: "1 Corinthians", chapter: 13, verse: 4 }, format: "deepgram" },
  ];
  cases.push(...deepgram);

  // Psalm 46:10 gate cases (Phase 6) — explicitly required
  const psalm4610Gate: TestCase[] = [
    { input: "Psalm 46:10",                                  expected: { book: "Psalms", chapter: 46, verse: 10 }, format: "tricky" },
    { input: "Psalm forty six verse ten",                    expected: { book: "Psalms", chapter: 46, verse: 10 }, format: "spoken_full" },
    { input: "Psalm 46 verse 10",                            expected: { book: "Psalms", chapter: 46, verse: 10 }, format: "spoken_full" },
    { input: "Psalms 46:10",                                 expected: { book: "Psalms", chapter: 46, verse: 10 }, format: "tricky" },
    { input: "Be still and know that I am God Psalm 46:10",  expected: { book: "Psalms", chapter: 46, verse: 10 }, format: "conversational" },
    { input: "Turn to Psalm 46 verse 10",                    expected: { book: "Psalms", chapter: 46, verse: 10 }, format: "conversational" },
  ];
  cases.push(...psalm4610Gate);

  return cases;
}

export const TEST_CASES: TestCase[] = generate();
export const PSALM_46_10_GATE: string[] = [
  "Psalm 46:10",
  "Psalm forty six verse ten",
  "Psalm 46 verse 10",
  "Psalms 46:10",
  "Be still and know that I am God Psalm 46:10",
  "Turn to Psalm 46 verse 10",
];
