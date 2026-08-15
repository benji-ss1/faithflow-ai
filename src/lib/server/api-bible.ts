// Server-only. Do not import from client components.
//
// API.Bible (api.scripture.api.bible) integration for licensed translations.
// Each translation is identified by a provider Bible ID. The church's API key
// is stored encrypted in licensed_translations.api_key_encrypted and decrypted
// here at request time.
//
// Verse ID format for API.Bible: <BOOK><CHP><VRS> where each component is
// zero-padded. Book codes follow USFM 3 abbreviations, e.g. "JHN" for John,
// "GEN" for Genesis. API.Bible uses the format: GEN.1.1 (dot-delimited).
//
// This module exposes one public function: fetchApiBibleVerses().
// All errors are caught and returned as null — callers degrade gracefully.

import { decrypt } from "./encryption";
import type { Verse } from "./bible";

// 24h in-process cache per (bibleId, book, chapter, verseStart, verseEnd)
// so repeated lookups during a service don't burn API quota.
type CacheEntry = { at: number; value: Verse[] };
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, CacheEntry>();
const MAX_CACHE_ENTRIES = 2000;

function cacheKey(bibleId: string, book: string, chapter: number, verseStart: number, verseEnd: number): string {
  return `${bibleId}|${book.toLowerCase()}|${chapter}|${verseStart}|${verseEnd}`;
}

function trimCache(): void {
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  const entries = [...cache.entries()].sort((a, b) => a[1].at - b[1].at);
  for (let i = 0; i < Math.floor(entries.length / 2); i++) cache.delete(entries[i][0]);
}

// Canonical USFM book abbreviations for the 66 books.
// API.Bible uses uppercase 3-char codes with no spaces.
const BOOK_CODE_MAP: Record<string, string> = {
  genesis: "GEN", gen: "GEN",
  exodus: "EXO", exo: "EXO", ex: "EXO",
  leviticus: "LEV", lev: "LEV",
  numbers: "NUM", num: "NUM",
  deuteronomy: "DEU", deu: "DEU", deut: "DEU",
  joshua: "JOS", jos: "JOS", josh: "JOS",
  judges: "JDG", jdg: "JDG", judg: "JDG",
  ruth: "RUT", rut: "RUT",
  "1 samuel": "1SA", "1sa": "1SA", "1sam": "1SA",
  "2 samuel": "2SA", "2sa": "2SA", "2sam": "2SA",
  "1 kings": "1KI", "1ki": "1KI", "1kgs": "1KI",
  "2 kings": "2KI", "2ki": "2KI", "2kgs": "2KI",
  "1 chronicles": "1CH", "1ch": "1CH", "1chr": "1CH",
  "2 chronicles": "2CH", "2ch": "2CH", "2chr": "2CH",
  ezra: "EZR", ezr: "EZR",
  nehemiah: "NEH", neh: "NEH",
  esther: "EST", est: "EST",
  job: "JOB",
  psalms: "PSA", psalm: "PSA", psa: "PSA", ps: "PSA",
  proverbs: "PRO", pro: "PRO", prov: "PRO",
  ecclesiastes: "ECC", ecc: "ECC", eccl: "ECC",
  "song of solomon": "SNG", "song of songs": "SNG", "song": "SNG", sng: "SNG", sos: "SNG",
  isaiah: "ISA", isa: "ISA",
  jeremiah: "JER", jer: "JER",
  lamentations: "LAM", lam: "LAM",
  ezekiel: "EZK", ezk: "EZK", ezek: "EZK",
  daniel: "DAN", dan: "DAN",
  hosea: "HOS", hos: "HOS",
  joel: "JOL", jol: "JOL",
  amos: "AMO", amo: "AMO",
  obadiah: "OBA", oba: "OBA",
  jonah: "JON", jon: "JON",
  micah: "MIC", mic: "MIC",
  nahum: "NAM", nam: "NAM",
  habakkuk: "HAB", hab: "HAB",
  zephaniah: "ZEP", zep: "ZEP", zeph: "ZEP",
  haggai: "HAG", hag: "HAG",
  zechariah: "ZEC", zec: "ZEC", zech: "ZEC",
  malachi: "MAL", mal: "MAL",
  matthew: "MAT", mat: "MAT", matt: "MAT",
  mark: "MRK", mrk: "MRK",
  luke: "LUK", luk: "LUK",
  john: "JHN", jhn: "JHN",
  acts: "ACT", act: "ACT",
  romans: "ROM", rom: "ROM",
  "1 corinthians": "1CO", "1co": "1CO", "1cor": "1CO",
  "2 corinthians": "2CO", "2co": "2CO", "2cor": "2CO",
  galatians: "GAL", gal: "GAL",
  ephesians: "EPH", eph: "EPH",
  philippians: "PHP", php: "PHP", phil: "PHP",
  colossians: "COL", col: "COL",
  "1 thessalonians": "1TH", "1th": "1TH", "1thess": "1TH",
  "2 thessalonians": "2TH", "2th": "2TH", "2thess": "2TH",
  "1 timothy": "1TI", "1ti": "1TI", "1tim": "1TI",
  "2 timothy": "2TI", "2ti": "2TI", "2tim": "2TI",
  titus: "TIT", tit: "TIT",
  philemon: "PHM", phm: "PHM",
  hebrews: "HEB", heb: "HEB",
  james: "JAS", jas: "JAS",
  "1 peter": "1PE", "1pe": "1PE", "1pet": "1PE",
  "2 peter": "2PE", "2pe": "2PE", "2pet": "2PE",
  "1 john": "1JN", "1jn": "1JN",
  "2 john": "2JN", "2jn": "2JN",
  "3 john": "3JN", "3jn": "3JN",
  jude: "JUD", jud: "JUD",
  revelation: "REV", rev: "REV",
};

export function toApiBibleBookCode(book: string): string | null {
  const key = book.toLowerCase().trim();
  return BOOK_CODE_MAP[key] ?? null;
}

// Book order used to populate Verse.bookOrder (1-66).
const BOOK_ORDER: Record<string, number> = Object.fromEntries([
  "GEN","EXO","LEV","NUM","DEU","JOS","JDG","RUT",
  "1SA","2SA","1KI","2KI","1CH","2CH","EZR","NEH",
  "EST","JOB","PSA","PRO","ECC","SNG","ISA","JER",
  "LAM","EZK","DAN","HOS","JOL","AMO","OBA","JON",
  "MIC","NAM","HAB","ZEP","HAG","ZEC","MAL",
  "MAT","MRK","LUK","JHN","ACT","ROM",
  "1CO","2CO","GAL","EPH","PHP","COL",
  "1TH","2TH","1TI","2TI","TIT","PHM",
  "HEB","JAS","1PE","2PE","1JN","2JN","3JN","JUD","REV",
].map((code, i) => [code, i + 1]));

// Parse the API.Bible `content-type=text` passage body into Verse[].
//
// With include-verse-numbers=true, the plain-text `data.content` looks like:
//   "     [16] For God so loved the world … life.  [17] God sent his Son … \n"
// i.e. each verse is prefixed by its number in square brackets, text following
// until the next "[N]" or end. This is stable across every translation (NIV/
// NKJV/NLT all verified 2026-08-15). We split on the "[N]" markers.
//
// (The previous parser walked the content-type=json tree looking for top-level
// items of type "verse" — but API.Bible nests the actual words several levels
// deep inside para → char → items[].text, so it extracted NOTHING and licensed
// verses projected as an empty slide with only the reference label. The text
// endpoint sidesteps that entirely.)
function parseVerseNumberedText(
  content: string,
  book: string,
  chapter: number,
  verseStart: number,
  verseEnd: number,
  translationId: string,
): Verse[] {
  const bookCode = toApiBibleBookCode(book) ?? "UNK";
  const bookOrder = BOOK_ORDER[bookCode] ?? 0;
  const verses: Verse[] = [];
  const re = /\[(\d+)\]([\s\S]*?)(?=\[\d+\]|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const vNum = parseInt(m[1]!, 10);
    if (!Number.isFinite(vNum) || vNum < verseStart || vNum > verseEnd) continue;
    const text = (m[2] ?? "").replace(/\s+/g, " ").trim();
    if (text) {
      verses.push({
        id: `${translationId}|${bookCode}|${chapter}|${vNum}`,
        book,
        bookOrder,
        chapter,
        verse: vNum,
        text,
      });
    }
  }
  return verses;
}

type ApiBibleTextResponse = {
  data?: { content?: string };
};

/**
 * Fetch a verse range from API.Bible.
 *
 * @param bibleId    Provider's opaque Bible ID (e.g. "78a9f6124f344018-01" for NIV)
 * @param apiKey     Plaintext API key (caller decrypts before passing)
 * @param book       Human book name (e.g. "John", "Genesis")
 * @param chapter    Chapter number
 * @param verseStart First verse
 * @param verseEnd   Last verse (inclusive)
 * @param translationId  Internal translation UUID (used only to populate Verse.id)
 * @returns Verse[] or null on error/empty
 */
export async function fetchApiBibleVerses(
  bibleId: string,
  apiKey: string,
  book: string,
  chapter: number,
  verseStart: number,
  verseEnd: number,
  translationId: string,
): Promise<Verse[] | null> {
  const ck = cacheKey(bibleId, book, chapter, verseStart, verseEnd);
  const cached = cache.get(ck);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  const bookCode = toApiBibleBookCode(book);
  if (!bookCode) return null;

  // Range passage ID: "JHN.3.16" (single) or "JHN.3.16-JHN.3.17" (range).
  const passageId = verseStart === verseEnd
    ? `${bookCode}.${chapter}.${verseStart}`
    : `${bookCode}.${chapter}.${verseStart}-${bookCode}.${chapter}.${verseEnd}`;
  // content-type=text + include-verse-numbers=true → the "[N] text" body we parse.
  const url = `https://api.scripture.api.bible/v1/bibles/${encodeURIComponent(bibleId)}/passages/${encodeURIComponent(passageId)}?content-type=text&include-notes=false&include-titles=false&include-chapter-numbers=false&include-verse-numbers=true&include-verse-spans=false`;

  try {
    const res = await fetch(url, {
      headers: { "api-key": apiKey },
      signal: AbortSignal.timeout(4000),
    });
    // 404 = the passage doesn't exist (e.g. Genesis 1:102). Distinguish that
    // from a transient failure so callers can surface "not a real verse".
    if (res.status === 404) return [];
    if (!res.ok) return null;

    const data = await res.json() as ApiBibleTextResponse;
    const content = data?.data?.content;
    if (typeof content !== "string" || !content.trim()) return [];

    const verses = parseVerseNumberedText(content, book, chapter, verseStart, verseEnd, translationId);

    cache.set(ck, { at: Date.now(), value: verses });
    trimCache();
    return verses;
  } catch {
    return null;
  }
}

/** For tests / admin diagnostics. */
export function clearApiBibleCache(): void {
  cache.clear();
}

/** Licensed translations this integration supports via API.Bible.
 *  The bibleId is the provider's opaque Bible ID and MUST match the exact
 *  translation — a wrong ID silently returns a DIFFERENT Bible's text.
 *  Verified 2026-08-15 against a live API.Bible key by fetching John 3:16 and
 *  confirming the wording:
 *    NIV  78a9f6124f344018-01 → "one and only Son … eternal life"
 *    NKJV 63097d2a0a2f7db3-01 → "only begotten Son … everlasting life"
 *    NLT  d6e14a625393b4da-01 → "For this is how God loved the world …"
 *  (The previous NKJV/NLT/AMP IDs pointed at the Cambridge-Paragraph KJV, the
 *  Free Bible Version, and the Literal Standard Version respectively — wrong
 *  text. AMP is not offered on the Starter API.Bible tier, so it's dropped;
 *  re-add with a verified ID if a plan includes it.) */
export const API_BIBLE_TRANSLATIONS: Array<{
  code: string;
  name: string;
  bibleId: string;
}> = [
  { code: "NIV",  name: "New International Version",  bibleId: "78a9f6124f344018-01" },
  { code: "NKJV", name: "New King James Version",     bibleId: "63097d2a0a2f7db3-01" },
  { code: "NLT",  name: "New Living Translation",     bibleId: "d6e14a625393b4da-01" },
];

/**
 * Decrypt the stored API key from a licensedTranslations row.
 * Returns null if the field is empty or decryption fails.
 */
export function decryptApiKey(apiKeyEncrypted: string | null | undefined): string | null {
  if (!apiKeyEncrypted) return null;
  try {
    return decrypt(apiKeyEncrypted);
  } catch {
    return null;
  }
}
