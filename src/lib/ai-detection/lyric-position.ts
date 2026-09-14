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
 * Score what fraction of a slide's meaningful (non-stopword) words appear
 * anywhere in recent speech, regardless of order.
 *
 * Used by the silence-based advance path: if the preacher/singer has spoken
 * ≥ THRESHOLD% of the current slide's content words AND there has been a
 * sustained pause, it's safe to infer they finished that slide and advance.
 *
 * @param recentWords  most recent spoken words (oldest→newest)
 * @param slideText    full text of the currently-live slide/verse
 * @returns 0–1 coverage score (0 = nothing spoken, 1 = fully covered)
 */
export function scoreCoverage(recentWords: string[], slideText: string): number {
  const spoken = new Set(recentWords.map(normWord).filter((w) => w.length > 0));
  const target = slideWords(slideText).filter((w) => !STOPWORDS.has(w));
  if (target.length === 0) return 0;
  const hits = target.filter((w) => spoken.has(w)).length;
  return hits / target.length;
}

export type BestSlideMatch = {
  /** Index of the best-matching slide, or -1 if nothing meaningful matched. */
  index: number;
  /** 0-100 confidence that the singer is on `index`. High only when the match
   *  is both strong AND unambiguous (clearly beats the runner-up). */
  confidence: number;
  /** Longest consecutive opening-word run found on the winning slide. */
  consecutiveMatches: number;
  /** Fraction (0-1) of the winning slide's content words heard recently. */
  coverage: number;
};

/**
 * Given recent spoken words and the FULL ordered list of a song's slide texts,
 * find which slide the singer is most likely on right now — used to SUGGEST
 * (never auto-move) jumping the live output to the slide actually being sung.
 *
 * Confidence is deliberately conservative: it is only high when the winning
 * slide has a strong signal (a long opening-word run OR high word coverage) AND
 * it clearly beats the runner-up. Near-ties (the bane of repetitive worship
 * songs with near-duplicate slides) collapse to LOW confidence, so the caller
 * won't surface a misleading suggestion. Pure + framework-free (unit-testable);
 * it NEVER touches live output.
 *
 * @param recentWords most recent spoken words, oldest→newest
 * @param slides      the song's slide lyric texts, in order
 */
export function matchBestSlide(recentWords: string[], slides: string[]): BestSlideMatch {
  const none: BestSlideMatch = { index: -1, confidence: 0, consecutiveMatches: 0, coverage: 0 };
  if (recentWords.length === 0 || slides.length === 0) return none;

  // Score every slide: a blend of the anchored opening-word run (strong signal
  // that the singer STARTED this slide) and overall content coverage (they're
  // somewhere in it). Stopword-only runs already score 0 inside matchNextSlide.
  const scored = slides.map((text, i) => {
    const run = matchNextSlide(recentWords, text, 2).consecutiveMatches;
    const cov = scoreCoverage(recentWords, text);
    // Weighted raw score. Run dominates (ordered opening match is the clearest
    // "they're on this slide" evidence); coverage fills in when words arrive
    // out of order or mid-slide.
    const raw = run * 12 + cov * 55;
    return { i, run, cov, raw };
  });
  scored.sort((a, b) => b.raw - a.raw);
  const best = scored[0];
  const second = scored[1];

  // Require a genuinely strong signal on the winner before ANY confidence.
  const strong = best.run >= 3 || best.cov >= 0.6;
  if (!strong) return { ...none, consecutiveMatches: best.run, coverage: best.cov };

  // Ambiguity check: the winner must clearly beat the runner-up, else it's a
  // near-duplicate-slide tie → keep confidence low so no suggestion is shown.
  const margin = best.raw - (second?.raw ?? 0);
  const clear = margin >= 18 || (second == null);

  // Base confidence from the raw strength, capped at 98 (never certainty).
  let confidence = Math.min(98, Math.round(best.raw));
  if (!clear) confidence = Math.min(confidence, 55); // ambiguous → below any surfacing bar

  return { index: best.i, confidence, consecutiveMatches: best.run, coverage: best.cov };
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
  // 2026-08-30 (field bug: plan-progression staged "Im so glad you here" while the
  // congregation was actively singing "glory to glory"): auto-progress to the next
  // PLAN item ONLY on a genuine SILENCE gap. The old "recent words no longer match
  // the last slide → assume ended" branch mis-fired the moment the congregation
  // started singing a DIFFERENT song — but that's exactly when the real lyric
  // detector (Part 5) should recognise and stage the song actually being sung, not
  // when we should blind-advance the plan. So: quiet gap ⇒ pre-stage next plan
  // song; active singing of anything else ⇒ leave it to real detection.
  if (silenceMs >= silenceFloorMs) return true;
  // Keep a fast-path ONLY when the transcript is essentially empty (no active
  // singing at all) yet the slide floor hasn't elapsed — a genuine dead-air tail.
  const m = matchNextSlide(recentWords, lastSlideText, 2);
  return m.consecutiveMatches === 0 && recentWords.length === 0;
}
