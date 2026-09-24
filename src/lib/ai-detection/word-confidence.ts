/**
 * Reference-scoped ASR confidence (2026-09-24 field bug, JPD live transcript).
 *
 * Deepgram reports ONE confidence for the whole utterance. `blendScripture` multiplied
 * the parser's score by it, so the longer the sentence, the lower a perfectly-heard
 * reference scored:
 *
 *   "John 3 verse 16"                                    dg 0.95 -> 87  fires
 *   "...the bible says in John 3 verse 16 this morning"  dg 0.80 -> 74  does NOT fire
 *
 * The reference words were heard just as clearly in both; only the surrounding sentence
 * dragged the average down. That is exactly the owner's report — "longer sentences which
 * have verses within them do not project". The same reasoning is already written into
 * the interim path ("utterance confidence reflects the whole sentence, NOT just the
 * verse reference"); this applies it to finals, where the words array is available.
 *
 * So: score the reference by the words it is actually made of. Pure + stateless so it is
 * directly unit-testable, like bible-antireplay.ts.
 */

export type AsrWord = { w: string; c: number };
export type Span = { start: number; end: number };

/** A word's confidence must be a real 0..1 number to count. */
function usable(c: unknown): c is number {
  return typeof c === "number" && Number.isFinite(c) && c >= 0 && c <= 1;
}

/**
 * Mean confidence of the words overlapping `span`, or null when it can't be determined
 * (no words, no span, or the word list doesn't line up with the transcript).
 *
 * Alignment: Deepgram's `words` are in transcript order, so the Nth whitespace-separated
 * token of the text is the Nth word. If the counts disagree the transcript has been
 * rewritten or trimmed (the bridge caps very long utterances), and we refuse rather than
 * score against the wrong words.
 *
 * `floor` is the LOWEST confidence among those words. A caller may want it so one badly
 * heard token inside the reference can't be averaged away by its neighbours.
 */
export function spanWordConfidence(
  text: string,
  words: AsrWord[] | undefined,
  span: Span | undefined,
): { mean: number; floor: number; count: number } | null {
  if (!text || !span || !Array.isArray(words) || words.length === 0) return null;
  if (!Number.isFinite(span.start) || !Number.isFinite(span.end) || span.end <= span.start) return null;

  const tokens: Span[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) tokens.push({ start: m.index, end: m.index + m[0].length });
  if (tokens.length !== words.length) return null;

  let sum = 0, count = 0, floor = 1;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.end <= span.start || t.start >= span.end) continue; // no overlap
    const c = words[i]?.c;
    if (!usable(c)) continue;
    sum += c; count++;
    if (c < floor) floor = c;
  }
  if (count === 0) return null;
  return { mean: sum / count, floor, count };
}

/**
 * The confidence `blendScripture` should multiply the parser score by.
 *
 * Prefers the reference's OWN words over the whole utterance. Deliberately conservative
 * in two ways, so this can only rescue a clearly-heard reference and never launder a
 * badly-heard one:
 *   - a word inside the reference below `WEAK_WORD` drops us back to the utterance
 *     confidence, so a garbled token is never averaged away by its neighbours;
 *   - the result is never allowed BELOW the utterance confidence, so this can only ever
 *     help a reference the sentence length was unfairly penalising.
 * Returns the utterance confidence unchanged whenever the words aren't usable.
 */
export const WEAK_WORD = 0.5;

export function referenceConfidence(
  utteranceConfidence: number | undefined,
  scoped: { mean: number; floor: number; count: number } | null,
): number | undefined {
  if (!scoped) return utteranceConfidence;
  if (scoped.floor < WEAK_WORD) return utteranceConfidence;
  if (!usable(utteranceConfidence)) return scoped.mean;
  return Math.max(utteranceConfidence, scoped.mean);
}
