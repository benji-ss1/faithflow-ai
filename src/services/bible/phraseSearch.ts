/**
 * Bible phrase search engine.
 *
 * Multi-strategy scoring over the curated phrase database in
 * `src/data/biblePhrases.ts`. Pure + synchronous + <10ms for the full
 * corpus (233 entries as of 2026-07-29) so it's safe to call on every
 * keystroke and from the live-audio detection hot path.
 *
 * Debounce/min-length is the CALLER's job — this module is a pure engine.
 *
 * Scoring strategies (additive, top-15 sorted by score, >20 to include):
 *  1. exact phrase substring         → +100
 *  2. altPhrase substring            → +90
 *  3. fullText substring             → +70
 *  4. all query words in keywords    → +60 else per-match +15
 *  5. theme/context match            → +10 per
 *  6. Levenshtein fuzzy fallback     → +12 per fuzzy match (when score < 30)
 *  7. Popularity boost               → +popularity × 2
 *
 * Every entry has an `id`; results include the original entry + the score.
 */

import { BIBLE_PHRASES, type BiblePhrase } from "@/data/biblePhrases";

export type PhraseSearchResult = {
  entry: BiblePhrase;
  score: number;
  /** Which strategy contributed most — for debug traces / UI hints. */
  primary: "phrase" | "alt" | "fullText" | "keywords" | "theme" | "fuzzy";
};

const MIN_INCLUDE_SCORE = 20;
const MAX_RESULTS = 15;
const FUZZY_TRIGGER_MAX = 30;

// Generic worship / high-frequency devotional vocabulary. These words recur in
// sung worship AND across dozens of verse entries, so a phrase match built ONLY
// on them (no distinctive content word, no contiguous substring hit) is worship
// vocabulary coinciding with a verse — not a real spoken quote. This was the
// source of the false "Psalms" chips during singing (field 2026-08-21: "who is
// seated at the right hand" → Psalms 109:1/91:2). A match must carry at least
// one DISTINCTIVE (non-stopword) keyword, or a phrase/alt/fullText substring, to
// earn the popularity boost and clear the include floor.
const WORSHIP_STOPWORDS = new Set([
  "lord", "god", "jesus", "christ", "father", "spirit", "holy", "holiness", "praise",
  "worship", "glory", "glorious", "name", "soul", "bless", "blessed", "blessing",
  "king", "kingdom", "love", "loved", "heart", "mighty", "great", "greatly", "worthy",
  "hand", "right", "seated", "throne", "grace", "mercy", "merciful", "high", "highest",
  "come", "sing", "song", "hallelujah", "amen", "hosanna", "exalt", "exalted", "above",
  "power", "glorify", "majesty", "almighty", "reign", "forever", "everlasting", "alive",
]);

// Precomputed lowercase snapshots. Populated lazily on first call so importing
// this module is free (no cost during module init at app boot).
type Indexed = {
  phraseLc: string;
  altLc: string[];
  fullTextLc: string;
  keywordSet: Set<string>;
  themeSet: Set<string>;
  contextSet: Set<string>;
};
let INDEX: Indexed[] | null = null;

function buildIndex() {
  INDEX = BIBLE_PHRASES.map((e) => ({
    phraseLc: e.phrase.toLowerCase(),
    altLc: (e.altPhrases || []).map((a) => a.toLowerCase()),
    fullTextLc: e.fullText.toLowerCase(),
    keywordSet: new Set((e.keywords || []).map((k) => k.toLowerCase())),
    themeSet: new Set((e.themes || []).map((t) => t.toLowerCase())),
    contextSet: new Set((e.contexts || []).map((c) => c.toLowerCase())),
  }));
}

/** Levenshtein edit distance — bounded loop, allocation-lean. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // Ping-pong two rows to keep GC quiet.
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      let v = prev[j - 1] + cost;
      const del = prev[j] + 1;
      const ins = curr[j - 1] + 1;
      if (del < v) v = del;
      if (ins < v) v = ins;
      curr[j] = v;
    }
    const tmp = prev; prev = curr; curr = tmp;
  }
  return prev[n];
}

/** Split query into normalized word tokens (letters+digits, ≥2 chars). */
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

export function phraseSearch(rawQuery: string): PhraseSearchResult[] {
  if (typeof rawQuery !== "string") return [];
  const query = rawQuery.trim().toLowerCase();
  if (query.length === 0) return [];
  if (INDEX === null) buildIndex();
  const idx = INDEX!;
  const queryWords = tokenize(query);
  if (queryWords.length === 0) return [];

  const hits: PhraseSearchResult[] = [];

  for (let i = 0; i < BIBLE_PHRASES.length; i++) {
    const entry = BIBLE_PHRASES[i];
    const ix = idx[i];
    let score = 0;
    let primary: PhraseSearchResult["primary"] = "keywords";

    // 1. Exact phrase substring — strongest signal
    if (ix.phraseLc.includes(query)) {
      score += 100;
      primary = "phrase";
    }

    // 2. altPhrase substring
    for (const a of ix.altLc) {
      if (a.includes(query)) {
        score += 90;
        if (primary === "keywords") primary = "alt";
        break;
      }
    }

    // 3. fullText substring
    if (ix.fullTextLc.includes(query)) {
      score += 70;
      if (primary === "keywords") primary = "fullText";
    }

    // 4. keyword coverage
    let allMatch = queryWords.length > 0;
    let perMatch = 0;
    for (const w of queryWords) {
      if (ix.keywordSet.has(w)) perMatch++;
      else allMatch = false;
    }
    if (allMatch && queryWords.length > 0) {
      score += 60;
      if (primary === "keywords") primary = "keywords";
    } else if (perMatch > 0) {
      score += 15 * perMatch;
    }

    // 5. theme / context boosts
    for (const w of queryWords) {
      if (ix.themeSet.has(w)) score += 10;
      if (ix.contextSet.has(w)) score += 10;
    }

    // 6. Levenshtein fuzzy fallback — only if the entry is otherwise weak.
    //    Compares each query word against keywords + primary phrase tokens.
    if (score < FUZZY_TRIGGER_MAX && queryWords.length > 0) {
      const phraseTokens = ix.phraseLc.split(/\s+/);
      let fuzz = 0;
      for (const w of queryWords) {
        if (w.length < 4) continue;
        // Only try keywords and phrase tokens with similar length.
        for (const k of ix.keywordSet) {
          if (Math.abs(k.length - w.length) > 2) continue;
          if (levenshtein(k, w) <= 1) { fuzz++; break; }
        }
        if (fuzz > 0) continue;
        for (const t of phraseTokens) {
          if (Math.abs(t.length - w.length) > 2) continue;
          if (levenshtein(t, w) <= 1) { fuzz++; break; }
        }
      }
      if (fuzz > 0) {
        score += 12 * fuzz;
        if (score >= MIN_INCLUDE_SCORE && primary === "keywords") primary = "fuzzy";
      }
    }

    // Distinctiveness: how many matched query words are NOT generic worship
    // vocabulary. A contiguous substring hit (phrase/alt/fullText) is itself a
    // strong, distinctive signal regardless of individual words.
    let distinctiveKeywordHits = 0;
    for (const w of queryWords) {
      if (ix.keywordSet.has(w) && !WORSHIP_STOPWORDS.has(w)) distinctiveKeywordHits++;
    }
    const hasSubstringHit = primary === "phrase" || primary === "alt" || primary === "fullText";

    // 7. Popularity boost — ONLY when the match has a real signal (a substring
    //    hit or a distinctive keyword), so a popular psalm can't float up on
    //    generic worship-word overlap + popularity alone.
    if (score > 0 && typeof entry.popularity === "number" && (hasSubstringHit || distinctiveKeywordHits >= 1)) {
      score += entry.popularity * 2;
    }

    // Generic-worship guard: a keyword/theme/fuzzy-only match with NO distinctive
    // word and NO substring hit is sung worship coinciding with a verse's
    // keywords, not a real quote — hold it below the include floor so it never
    // surfaces as a chip during singing. Real spoken quotes carry a distinctive
    // word (shepherd, wretch, world…) or a contiguous substring, so are unaffected.
    if (!hasSubstringHit && distinctiveKeywordHits === 0) {
      score = Math.min(score, MIN_INCLUDE_SCORE - 1);
    }

    if (score >= MIN_INCLUDE_SCORE) {
      hits.push({ entry, score, primary });
    }
  }

  hits.sort((a, b) => b.score - a.score || b.entry.popularity - a.entry.popularity);
  return hits.slice(0, MAX_RESULTS);
}

/**
 * Convenience: does the query, at the phrase-search level, produce a
 * high-confidence spoken-phrase match? Used by the AI-detection wiring:
 *  70-80 → 65% confidence
 *  80-90 → 80% confidence
 *  90+   → 90% confidence
 * Returns null below the 70 floor.
 */
export function topPhraseForSpeech(
  rawQuery: string,
): { entry: BiblePhrase; score: number; confidence: number } | null {
  const hits = phraseSearch(rawQuery);
  const top = hits[0];
  if (!top) return null;
  if (top.score < 70) return null;
  const confidence = top.score >= 90 ? 90 : top.score >= 80 ? 80 : 65;
  return { entry: top.entry, score: top.score, confidence };
}

/**
 * Look up the curated phrase entry for an exact Bible reference
 * (case-insensitive, whitespace-tolerant). Returns null if the reference
 * isn't in the phrase database — callers use that to hide the RELATED
 * VERSES section rather than render an empty label.
 */
export function findPhraseByReference(ref: string): BiblePhrase | null {
  if (typeof ref !== "string") return null;
  const norm = ref.trim().replace(/\s+/g, " ").toLowerCase();
  if (!norm) return null;
  for (const e of BIBLE_PHRASES) {
    if (e.reference.trim().replace(/\s+/g, " ").toLowerCase() === norm) return e;
  }
  return null;
}

/** Reset the internal index — testing helper. */
export function _resetIndex() { INDEX = null; }

