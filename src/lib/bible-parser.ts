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
  ["Exodus", ["exodus", "exod", "exo", "exodous"]],
  ["Leviticus", ["leviticus", "lev", "lv"]],
  ["Numbers", ["numbers", "num", "nm", "nb"]],
  // "deuteromy" — very common Deepgram mishearing (drops the second N).
  ["Deuteronomy", ["deuteronomy", "deuteromy", "deuteronomay", "deut", "deu", "dt"]],
  ["Joshua", ["joshua", "josh", "jos"]],
  ["Judges", ["judges", "judg", "jdg", "jgs"]],
  // "route" — very common Deepgram mishearing of "Ruth" in speech
  // (they're near-homophones for many accents).
  ["Ruth", ["ruth", "rut", "route"]],
  // Multi-word ASR mishears ("first salvo"/"first sample" for "First Samuel")
  // are added as explicit variants — the single-token fuzzyBookMatch can't
  // reach them, and BOOK_PATTERN already matches multi-word variants (like
  // "song of solomon"). Gated in practice by the chapter:verse shape the
  // patterns require, so they never fire on ordinary speech. "salvo"→"samuel"
  // is a confirmed field error.
  ["1 Samuel", ["1 samuel", "first samuel", "1st samuel", "one samuel", "i samuel", "1 sam", "1sam", "1 sm", "1s", "first salvo", "first sample", "first salmon"]],
  ["2 Samuel", ["2 samuel", "second samuel", "2nd samuel", "two samuel", "ii samuel", "2 sam", "2sam", "2 sm", "2s", "second salvo", "second sample"]],
  ["1 Kings", ["1 kings", "first kings", "1st kings", "one kings", "i kings", "1 kgs", "1kgs"]],
  ["2 Kings", ["2 kings", "second kings", "2nd kings", "two kings", "ii kings", "2 kgs", "2kgs"]],
  ["1 Chronicles", ["1 chronicles", "first chronicles", "1st chronicles", "one chronicles", "i chronicles", "1 chron", "1 chr", "1 ch"]],
  ["2 Chronicles", ["2 chronicles", "second chronicles", "2nd chronicles", "two chronicles", "ii chronicles", "2 chron", "2 chr", "2 ch"]],
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
  // Habakkuk is badly garbled by ASR — "habba cook", "have a cook", etc. are
  // confirmed real mishears. Safe as explicit variants: they only parse as a
  // book when followed by a chapter:verse.
  ["Habakkuk", ["habakkuk", "hab", "habba cook", "have a cook", "havoc cook", "abba cook", "hab a cook", "havakkuk"]],
  ["Zephaniah", ["zephaniah", "zeph", "zep"]],
  ["Haggai", ["haggai", "hag"]],
  ["Zechariah", ["zechariah", "zech", "zec"]],
  ["Malachi", ["malachi", "mal"]],
  ["Matthew", ["matthew", "matt", "mt"]],
  // "mac" / "mak" — Nigerian/African-English ASR renderings of "mark"
  // (the "rk" cluster softens to a hard "c"/"k"). fuzzyBookMatch won't
  // catch 3-char inputs (threshold < 4), so explicit variants are needed.
  ["Mark", ["mark", "mk", "mr", "mac", "mak"]],
  ["Luke", ["luke", "lk", "lu"]],
  ["John", ["john", "jn", "jhn"]],
  ["Acts", ["acts", "act", "acts of the apostles", "acts of the apostle", "the acts of the apostles", "acts of apostle", "acts of apostles"]],
  ["Romans", ["romans", "roman", "rom", "rm"]],
  ["1 Corinthians", ["1 corinthians", "first corinthians", "1st corinthians", "one corinthians", "i corinthians", "1 cor", "1cor", "i cor"]],
  ["2 Corinthians", ["2 corinthians", "second corinthians", "2nd corinthians", "two corinthians", "ii corinthians", "2 cor", "2cor", "ii cor"]],
  ["Galatians", ["galatians", "gal"]],
  ["Ephesians", ["ephesians", "eph"]],
  // "filippians" (misspelling) is safe as an explicit variant. "philippines"
  // (the country) is deliberately NOT added — it's common English and would
  // false-fire on "the Philippines four times"; the strict-shape fuzzyBookMatch
  // path already recovers "philippines four:thirteen" at low confidence.
  ["Philippians", ["philippians", "phil", "php", "filippians"]],
  ["Colossians", ["colossians", "col", "colo", "colos"]],
  ["1 Thessalonians", ["1 thessalonians", "first thessalonians", "1st thessalonians", "one thessalonians", "i thessalonians", "1 thess", "1 thes"]],
  ["2 Thessalonians", ["2 thessalonians", "second thessalonians", "2nd thessalonians", "two thessalonians", "ii thessalonians", "2 thess", "2 thes"]],
  ["1 Timothy", ["1 timothy", "first timothy", "1st timothy", "one timothy", "i timothy", "1 tim", "1tim"]],
  ["2 Timothy", ["2 timothy", "second timothy", "2nd timothy", "two timothy", "ii timothy", "2 tim", "2tim"]],
  ["Titus", ["titus", "tit"]],
  // "fill a man" / "feel a man" are confirmed ASR mishears of Philemon. Real
  // English, but only parses as a book before a chapter:verse ("fill a man 1:6"),
  // which is not a natural non-scripture utterance.
  ["Philemon", ["philemon", "philem", "phlm", "phm", "fill a man", "feel a man"]],
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
  // 2026-07-25 field bug fix: "N is M" between two numbers is almost always
  // a Deepgram mishearing of "N:M" (chapter:verse). "Route 4 is 1" →
  // "Ruth 4:1", "Numbers 24 is 3" → "Numbers 24:3", etc. Guarded to
  // fire ONLY when digits appear on both sides so ordinary English
  // ("truth is love", "verse is important") isn't touched.
  //
  // 2026-07-26 extension: same treatment for "was" / "has" / "and" / "at" /
  // "of" — Deepgram consistently mangles the word "verse" between two digits
  // into these short function words, especially in African-accented speech
  // ("Nehemiah 2 was 1", "Romans 8 has 8", "John 3 and 16", "Matthew 5 of 5"
  //  → "verse" every time). Same digits-both-sides guard so ordinary English
  // ("truth was told", "5 and counting") isn't touched.
  s = s.replace(/\b(\d{1,3})\s+(?:is|was|has|and|at|of|are|were)\s+(\d{1,3})\b/g, "$1:$2");
  return s;
}

// English (non-TH) number homophones. Deepgram mishears spoken digits as
// same-sounding ordinary words: "Judges eleven four" → "Judges eleven floor",
// "John ten three" → "John ten tree", "Mark five nine" → "Mark five nein",
// "Romans eight twenty eight" → "...twenty ate". repairNumberHomophones above
// deliberately refuses these globally because they're common English.
//
// This pass rewrites them ONLY with PROOF we're already inside a reference: the
// token immediately before the homophone must be a GENUINE number, or an
// explicit "verse"/"chapter" marker — AND we must be within a short window of a
// recognized book name — AND the token after must not be a plain content word.
// So a mangled number is only fixed once a clean number (or the word "verse")
// pins us mid-reference. This is intentionally conservative: it will MISS the
// rare case where the chapter number ITSELF is mangled ("Acts too thirty",
// "Genesis won won") because there's no clean anchor — a safe no-detection the
// operator resolves manually — but it never fabricates a verse from ordinary
// speech ("Mark ate five apples", "Romans eight won by grace" → no reference).
// Bare "for"/"to" are excluded entirely: as a chapter slot they're
// indistinguishable from narration ("Luke, to ten of you…").
const NUM_HOMOPHONES_SAFE: Record<string, string> = {
  won: "one", wan: "one", wun: "one",
  too: "two", tew: "two",
  thee: "three", free: "three",
  floor: "four", fore: "four", ford: "four", faur: "four",
  fives: "five", fife: "five",
  sicks: "six",
  ate: "eight", ait: "eight",
  nein: "nine",
  tin: "ten",
  leaven: "eleven",
};
// Non-number tokens allowed to appear INSIDE a reference span without ending
// the window (so "John chapter ten verse tree" still reaches "tree").
const REF_CONNECTORS = new Set(["chapter", "verse", "verses", "the", "through", "thru", "dash", "colon", "and", "from"]);
// Explicit number-slot markers: a homophone directly after one of these is
// unambiguously the number ("chapter ate" → chapter 8, "verse ate" → verse 8).
const SLOT_MARKERS = new Set(["verse", "verses", "chapter"]);
function repairBibleContextHomophones(s: string): string {
  if (!/[a-z]/.test(s)) return s;
  const tokens = s.split(" ");
  const isNumTok = (t: string | undefined): boolean =>
    t !== undefined && (/^\d+$/.test(t) || NUMBER_WORDS[t] !== undefined);
  const isHomophone = (t: string | undefined): boolean =>
    t !== undefined && Object.prototype.hasOwnProperty.call(NUM_HOMOPHONES_SAFE, t);
  // Snapshot the ORIGINAL numeric classification so a rewrite (homophone→number)
  // can never chain into fabricating the next slot (the review 🔴: "Mark ate too"
  // → 8:2). Every decision below reads origIsNum, never the mutated array.
  const origIsNum = tokens.map(isNumTok);
  // A book name ends at index i if tok[i], or the 2-/3-token join ending at i,
  // is a known variant (covers "1 corinthians", "song of solomon").
  const bookEndsAt = (i: number): boolean => {
    if (VARIANT_TO_BOOK.has(tokens[i])) return true;
    if (i >= 1 && VARIANT_TO_BOOK.has(`${tokens[i - 1]} ${tokens[i]}`)) return true;
    if (i >= 2 && VARIANT_TO_BOOK.has(`${tokens[i - 2]} ${tokens[i - 1]} ${tokens[i]}`)) return true;
    return false;
  };
  const WINDOW = 6;
  let sinceBook = Infinity; // tokens since the last book name ended
  let changed = false;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (sinceBook <= WINDOW && Object.prototype.hasOwnProperty.call(NUM_HOMOPHONES_SAFE, tok)) {
      const prev = tokens[i - 1];
      const next = tokens[i + 1];
      // PROOF we're in a reference: previous token is a genuine number or an
      // explicit verse/chapter marker.
      const anchoredLeft = origIsNum[i - 1] === true || (prev !== undefined && SLOT_MARKERS.has(prev));
      // The token after must not be a plain content word — end, another number,
      // a homophone, or a connector. Blocks "Mark five ate breakfast" and
      // "Romans eight won by grace".
      const rightOk = next === undefined || origIsNum[i + 1] === true || isHomophone(next) || REF_CONNECTORS.has(next);
      if (anchoredLeft && rightOk) { tokens[i] = NUM_HOMOPHONES_SAFE[tok]; changed = true; }
    }
    // Update window AFTER processing this token so the token right after a book
    // (the chapter slot) is in-window.
    if (bookEndsAt(i)) sinceBook = 0;
    else if (origIsNum[i] || REF_CONNECTORS.has(tokens[i]) || isHomophone(tokens[i])) {
      sinceBook += 1; // reference-ish token: keep the window alive (bounded by WINDOW)
    } else {
      sinceBook = Infinity; // a clearly non-reference word closes the span
    }
  }
  return changed ? tokens.join(" ") : s;
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
  // 2026-07-24 extension: also surface FUZZY BOOK MATCHES as corrections.
  // The parser's fuzzyBookMatch() catches near-miss book names like
  // "filippians" → "Philippians", "corintians" → "Corinthians",
  // "ecclesiastis" → "Ecclesiastes". Feeding these into the correction
  // stream makes the yellow-highlight visibly fire on the most common
  // real-world mis-transcription (accented / rushed book names) instead
  // of only the rare TH-fronting number cases above. Same shape as
  // number repairs so the client render path is unchanged.
  // Scan word tokens; skip anything already canonically known.
  const wordRe = /\b([A-Za-z][A-Za-z']{3,20})\b/g;
  let wm: RegExpExecArray | null;
  while ((wm = wordRe.exec(rawText)) !== null) {
    const token = wm[1];
    const lower = token.toLowerCase();
    // Skip exact-known book names (VARIANT_TO_BOOK already handles them).
    if (VARIANT_TO_BOOK.has(lower)) continue;
    const book = fuzzyBookMatch(lower);
    if (!book) continue;
    // Only surface if it's actually a different string (not just casing).
    if (book.toLowerCase() === lower) continue;
    const key = `${lower}→${book.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ original: token, corrected: book });
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

  // English number homophones (floor→four, won→one, nein→nine…), gated to a
  // book+number reference slot so ordinary speech is never touched. Runs after
  // TH-fronting (so "tree" is already "three") and before the compound-number
  // fusion below (so "twenty ate"→"twenty eight"→ fused 28).
  s = repairBibleContextHomophones(s);

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
/**
 * Given a book and a run of 3–5 digits fused to it (e.g. `1010` after
 * `john`), decide whether the digits represent a whole chapter or a
 * chapter+verse pair, and return the parsed form.
 *
 * Whole-chapter takes priority whenever the full number is a valid chapter
 * for the book AND ≥ 100 (so `psalm119` → Psalm 119, `psalm150` → Psalm 150,
 * not `1:19`/`1:50`). Below 100, whole is ambiguous with ch:vs so we
 * always split (`john316` → 3:16, `matt125` → 1:25).
 *
 * Split preference per digit count matches how people naturally type:
 *   3 digits: 1+2 first (john316 → 3:16), then 2+1 (job121 → 12:1)
 *   4 digits: 2+2 first (john1010 → 10:10), then 1+3, then 3+1
 *   5 digits: 3+2 first (psalms11911 → 119:11), then 2+3
 * Rejects splits where chapter exceeds book's max or verse is 0/leading-zero.
 */
type FusedResult = { chapter: number; verse: number | null };
function trySplitFusedDigits(book: string, digits: string): FusedResult | null {
  const n = digits.length;
  if (n < 3 || n > 5) return null;
  const maxCh = maxChapterFor(book);
  const whole = parseInt(digits, 10);
  // Whole-chapter shortcut when it's plausible (≥ 100 and within range).
  // Only Psalms actually goes past 99, so in practice this branch fires
  // for "psalm100" through "psalm150" (the popular ones) and stays out
  // of the way for every other book.
  if (typeof maxCh === "number" && whole >= 100 && whole <= maxCh) {
    return { chapter: whole, verse: null };
  }
  const orders: Record<number, number[]> = {
    3: [1, 2],
    4: [2, 1, 3],
    5: [3, 2],
  };
  for (const chLen of orders[n]) {
    if (chLen >= n) continue;
    const chStr = digits.slice(0, chLen);
    const vsStr = digits.slice(chLen);
    if (chStr.length > 1 && chStr.startsWith("0")) continue;
    if (vsStr.length > 1 && vsStr.startsWith("0")) continue;
    const ch = parseInt(chStr, 10);
    const vs = parseInt(vsStr, 10);
    if (!Number.isFinite(ch) || !Number.isFinite(vs)) continue;
    if (ch <= 0 || vs <= 0 || vs > 176) continue;
    if (typeof maxCh === "number" && ch > maxCh) continue;
    return { chapter: ch, verse: vs };
  }
  return null;
}

const PATTERNS: { name: string; regex: RegExp; parse: (m: RegExpExecArray) => ParsedReference | null }[] = [
  // "SingleChapterBook verse N"
  {
    name: "single_chapter_book_verse",
    // Don't match when the "verse" number is really a chapter followed by
    // ":verse" — for single-chapter books people often still write "1:6"
    // (chapter 1, verse 6). That case is handled correctly by
    // book_ch_colon_verse below once we skip it here.
    regex: new RegExp(`\\b(obadiah|philemon|2 john|3 john|second john|third john|jude)\\s+(?:verse\\s+)?${NUM_CHUNK}\\b(?!\\s*:)`, "gi"),
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
      // Chapter-only books (Obadiah, Philemon, 2/3 John, Jude): when
      // written "Philemon 1:6" (with explicit chapter=1 + colon), the
      // second number is the verse. Only fall back to "first number is
      // verse" if the leading number isn't literally 1 (which would be
      // impossible as a real verse-in-chapter-that-doesn't-exist).
      if (SINGLE_CHAPTER_BOOKS.has(book)) {
        if (chapter === 1) {
          return { book, chapter: 1, verseStart: verse, verseEnd: verse, confidence: 92, matchedText: m[0], needsSemanticFallback: false };
        }
        return { book, chapter: 1, verseStart: chapter, verseEnd: chapter, confidence: 90, matchedText: m[0], needsSemanticFallback: false };
      }
      if (!isValidChapter(book, chapter)) return null;
      return { book, chapter, verseStart: verse, verseEnd: verse, confidence: 92, matchedText: m[0], needsSemanticFallback: false };
    },
  },
  // "BookNNNN" fused digits (no space, no separator) → chapter+verse split.
  // Handles the shorthand people naturally type on mobile / when in a hurry:
  //   john1010 → John 10:10
  //   john316  → John 3:16
  //   ps11911  → Psalms 119:11
  //   matt77   → skipped (only 2 digits — see below)
  // Applies to EVERY book (not hard-coded to one), using the shared BOOK_PATTERN.
  // Requires 3-5 digits: 2-digit is too ambiguous with whole-chapter shortcuts
  // ("psalm91" almost certainly means Psalm 91 the whole chapter, not 9:1).
  // Split-choice heuristic below prefers the most-likely operator intent
  // per digit count, then filters against per-book max chapter + 1..176 verse
  // range so a nonsense split is rejected rather than misfiring.
  {
    name: "book_fused_digits",
    regex: new RegExp(`\\b(${BOOK_PATTERN})(\\d{3,5})\\b`, "gi"),
    parse: (m) => {
      const bookKey = m[1].toLowerCase().replace(/\s+/g, " ");
      const book = VARIANT_TO_BOOK.get(bookKey);
      if (!book) return null;
      const split = trySplitFusedDigits(book, m[2]);
      if (!split) return null;
      if (SINGLE_CHAPTER_BOOKS.has(book)) {
        const v = parseInt(m[2], 10);
        if (!Number.isFinite(v) || v <= 0 || v > 176) return null;
        return { book, chapter: 1, verseStart: v, verseEnd: v, confidence: 82, matchedText: m[0], needsSemanticFallback: false };
      }
      if (split.verse === null) {
        // Whole-chapter case (Psalm 119, Psalm 150). Match book_ch's
        // encoding (verseStart=1, verseEnd=1) so downstream lookup code
        // treats it the same as a spoken "Psalm 119".
        return { book, chapter: split.chapter, verseStart: 1, verseEnd: 1, confidence: 80, matchedText: m[0], needsSemanticFallback: false };
      }
      return { book, chapter: split.chapter, verseStart: split.verse, verseEnd: split.verse, confidence: 82, matchedText: m[0], needsSemanticFallback: false };
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
    // 2026-07-24 fix — F1 from Pass 2 accuracy audit. Original 2-word
    // candidate greedy-ate context words ("to filippians") which fuzzy-
    // match then rejected as a book name — and the regex engine doesn't
    // backtrack to try the shorter "filippians" alone. Restricted to
    // 1-word candidates: covers the overwhelmingly-common misspelled-
    // single-book case (Habakkuk, Philippians, Ecclesiastes, etc.).
    // Two-word real book names ("song of solomon", "1 kings", "second
    // corinthians") are already handled by exact-match regexes above,
    // so this pattern doesn't need to cover them.
    regex: new RegExp(
      `\\b([a-z]+)\\s+(?:chapter\\s+)?${NUM_CHUNK}\\s*(?::|\\s+verses?\\s+|,\\s*)\\s*${NUM_CHUNK}\\b(?!\\s*(?:to\\b|through\\b|thru\\b|-|–|—))`,
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
  // Fuzzy fallback for SPOKEN form ("filippians four thirteen"). Same
  // safety gate as fuzzy_book_ch_verse (candidate must not be an exact
  // known variant, must fuzzy-match a real book, chapter must validate),
  // plus the stricter NUM_SINGLE atoms so we can't drift into arbitrary
  // number-word sequences. Requires the candidate to be ≥6 letters so we
  // don't fuzzy-match short English words ("read", "give") against short
  // book names ("Ezra", "Ruth").
  {
    name: "fuzzy_book_ch_space_verse",
    regex: new RegExp(
      `\\b([a-z]{6,20})\\s+(?:chapter\\s+)?${NUM_SINGLE}\\s+${NUM_SINGLE}\\b(?!\\s*(?:to\\b|through\\b|thru\\b|-|–|—|hundred\\b))`,
      "gi",
    ),
    parse: (m) => {
      const candidate = m[1].toLowerCase().trim();
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
// Typed-input-only alias map. These two-letter tokens deliberately DO NOT
// live in RAW_BOOKS because they collide with common English words during
// live speech ("ex", "is", "am", "ac", "ru", "re"). But when an operator
// TYPES them into the reference field they unambiguously mean the book —
// nobody types "am 2" hoping for a sermon search on "am". Applied only via
// parseTypedReference() below (and NEVER via the live ASR path).
const TYPED_ONLY_ALIASES: Record<string, string> = {
  ex: "Exodus",
  ru: "Ruth",
  is: "Isaiah",
  am: "Amos",
  ac: "Acts",
  re: "Revelation",
  ph: "Philippians",
  jd: "Jude",
};

/**
 * Reference parser tuned for TYPED input (reference field / search palette).
 * Same rules as parseReferences() but with two additional accommodations
 * that would false-fire on live speech but are safe when a human is typing:
 *  1. Applies TYPED_ONLY_ALIASES (`ex 2 1` → `exodus 2 1`).
 *  2. Interprets bare space-separated numbers after a book as chapter+verse
 *     ("EX 2 1" → Exodus 2:1) — this ALREADY works via book_ch_space_verse
 *     in parseReferences(), the alias expansion is the missing piece.
 */
export function parseTypedReference(rawText: string): ParsedReference[] {
  if (!rawText || typeof rawText !== "string") return [];
  // Expand typed-only book abbreviations at the head of the input. Match
  // case-insensitively and require a following digit (or word-number) so a
  // bare "ex" alone doesn't get expanded into a doomed lookup.
  const expanded = rawText.replace(
    /^\s*(ex|ru|is|am|ac|re|ph|jd)\b/i,
    (_m, abbr: string) => TYPED_ONLY_ALIASES[abbr.toLowerCase()] || abbr,
  );
  return parseReferences(expanded);
}

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
