/**
 * Part 7 — word-timing slide-position matching utility.
 *
 * Pure, framework-free matching logic so it's unit-testable without React
 * or a live mic. Consumer (ProOperatorShell) feeds in the most recent N
 * words of live transcript plus the text of the NEXT slide in an
 * already-live song, and gets back a confidence score for "the singer has
 * moved into this next slide's lyrics."
 *
 * IMPORTANT — this module NEVER calls anything live-related itself. It only
 * computes a score. The caller decides whether/when to move the slide
 * index, using the same slide-advance primitive manual "Next slide" uses.
 * It has no access to ctx.onSendSlideToLive and must never be given it.
 */

/** Normalize a word for comparison: lowercase, strip punctuation. */
function normWord(w: string): string {
  return w.toLowerCase().replace(/[^a-z0-9']/g, "");
}

/** Split slide text into a flat list of normalized words. */
export function slideWords(text: string): string[] {
  return text
    .split(/\s+/)
    .map(normWord)
    .filter((w) => w.length > 0);
}

/**
 * Very common filler words that don't count as meaningful match signal on
 * their own — a single hit on one of these must never be treated as
 * "the singer moved to the next slide."
 */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "of", "to", "in", "is", "it", "i", "you",
  "my", "me", "on", "for", "we", "oh", "yeah", "so", "that",
]);

export type LyricMatchResult = {
  /** Number of consecutive matching words found at the tail of `recentWords`. */
  consecutiveMatches: number;
  /** 0-100 confidence that the singer has moved into `nextSlideText`. */
  confidence: number;
};

/**
 * Compare the tail of recently-spoken words against the opening words of
 * the next slide's lyrics. Requires several CONSECUTIVE matching words
 * (not a single common-word hit) before returning any meaningful
 * confidence — a lone "the" or "and" match is explicitly insufficient.
 *
 * @param recentWords   most recent spoken words, oldest→newest, plain strings
 * @param nextSlideText full text of the next slide in the live song
 * @param minConsecutive minimum consecutive matching words required (default 3)
 */
export function matchNextSlide(
  recentWords: string[],
  nextSlideText: string,
  minConsecutive = 3,
): LyricMatchResult {
  const spoken = recentWords.map(normWord).filter((w) => w.length > 0);
  const target = slideWords(nextSlideText);
  if (spoken.length === 0 || target.length === 0) {
    return { consecutiveMatches: 0, confidence: 0 };
  }

  // Slide a window of target's opening words across the tail of `spoken`
  // looking for the longest run of consecutive matches, anchored at the
  // END of `spoken` (i.e. what was JUST said) so stale earlier words in
  // the buffer don't produce false long-ago matches.
  let best = 0;
  const maxLookback = Math.min(spoken.length, target.length + 6);
  for (let start = spoken.length - maxLookback; start < spoken.length; start++) {
    if (start < 0) continue;
    let run = 0;
    for (let k = 0; start + k < spoken.length && k < target.length; k++) {
      if (spoken[start + k] === target[k] && spoken[start + k].length > 0) {
        run++;
      } else {
        break;
      }
    }
    if (run > best) best = run;
  }

  // A run entirely made of stopwords never counts, even if long enough —
  // guards against "the the the" type degenerate matches.
  if (best > 0) {
    const runWords = target.slice(0, best);
    const allStop = runWords.every((w) => STOPWORDS.has(w));
    if (allStop) best = 0;
  }

  if (best < minConsecutive) {
    return { consecutiveMatches: best, confidence: 0 };
  }

  // Confidence scales with run length beyond the floor, capped at 98 (never
  // 100 — this is a heuristic signal, not certainty).
  const over = best - minConsecutive;
  const confidence = Math.min(98, 70 + over * 8);
  return { consecutiveMatches: best, confidence };
}

/**
 * Detect "song appears to be ending": the live song is on its last slide
 * AND there's no further matching signal against that last slide's
 * remaining/trailing lyrics (i.e. transcript has moved past it or gone
 * quiet). Pure helper for Part 8's end-of-song detection.
 */
export function isLikelyEndOfSong(opts: {
  isLastSlide: boolean;
  recentWords: string[];
  lastSlideText: string;
  silenceMs: number;
  silenceFloorMs?: number;
}): boolean {
  const { isLastSlide, recentWords, lastSlideText, silenceMs, silenceFloorMs = 4000 } = opts;
  if (!isLastSlide) return false;
  if (silenceMs >= silenceFloorMs) return true;
  // Or: recent words no longer match the last slide's own lyrics at all —
  // singer has moved on to spoken word / next song without a matched next
  // slide (there isn't one, since this IS the last slide).
  const m = matchNextSlide(recentWords, lastSlideText, 2);
  return m.consecutiveMatches === 0 && recentWords.length >= 4;
}
