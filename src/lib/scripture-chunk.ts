/**
 * Scripture verse chunking — pure, deterministic core.
 *
 * Splits a LONG verse (or verse-range / long translation like AMP/MSG) into an
 * ordered list of readable CARDS that fit the projected area, so a long verse is
 * shown big across several cards the operator advances — instead of shrinking to
 * an unreadable single slide.
 *
 * CRITICAL — unlike the song chunker, this NEVER alters the words: no grammar
 * pass, no punctuation stripping, no case change. Scripture text is immutable
 * (rule: the words of scripture are locked). We only choose WHERE to break, at
 * sentence > clause > word boundaries, never mid-word.
 *
 * Layout-aware: a lower-third band holds far less than a full screen, so the
 * default card size differs by layout (and the caller may override maxWords when
 * it knows the exact band height / font scale). Toggling layout re-chunks with
 * the other size — which is exactly the "cards resize when you switch layout"
 * behaviour the operator asked for.
 *
 * Pure: no DB, no I/O, no Date/Math.random. Deterministic for a given input.
 */

export type ScriptureChunkLayout = "fullscreen" | "lowerThird";

export interface ScriptureChunkOptions {
  /** Hard cap of words per card. Overrides the layout default when set. */
  maxWords?: number;
  /** Soft target — a card ends early once it reaches this AND hits a sentence/
   *  clause boundary. Overrides the layout default when set. */
  softWords?: number;
}

// Defaults. Lower-third bands are small (~2-3 big lines), full screen holds more.
// Tuned so the verse stays BIG and readable rather than shrinking to fit.
const LAYOUT_DEFAULTS: Record<ScriptureChunkLayout, { max: number; soft: number }> = {
  lowerThird: { max: 20, soft: 12 },
  fullscreen: { max: 48, soft: 34 },
};

const INPUT_MAX_CHARS = 6000; // sanity cap (a long AMP verse-range is ~1-2k)

/** True if a word token ends a sentence (strong break). Handles trailing quotes
 *  / brackets e.g. `life.”` or `God!)`. */
function endsSentence(word: string): boolean {
  return /[.!?]["'”’)\]]*$/.test(word);
}
/** True if a word token ends a clause (weak break) e.g. `world,` `Son;`. */
function endsClause(word: string): boolean {
  return /[,;:]["'”’)\]]*$/.test(word);
}

/**
 * Chunk a verse into cards. Returns [] for empty input, [text] for a short verse
 * (one card). Words are re-joined with single spaces (verses are single-spaced);
 * the text is otherwise untouched.
 */
export function chunkScripture(
  text: string,
  layout: ScriptureChunkLayout = "fullscreen",
  opts: ScriptureChunkOptions = {},
): string[] {
  if (typeof text !== "string") return [];
  const clean = (text.length > INPUT_MAX_CHARS ? text.slice(0, INPUT_MAX_CHARS) : text)
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return [];

  const d = LAYOUT_DEFAULTS[layout] ?? LAYOUT_DEFAULTS.fullscreen;
  const max = Math.max(3, Math.round(opts.maxWords ?? d.max));
  const soft = Math.max(2, Math.min(max, Math.round(opts.softWords ?? d.soft)));

  const words = clean.split(" ").filter(Boolean);
  if (words.length <= max) return [clean]; // fits one card — never split needlessly

  const cards: string[] = [];
  let cur: string[] = [];
  for (let i = 0; i < words.length; i++) {
    cur.push(words[i]);
    const atHardCap = cur.length >= max;
    // Prefer to end a card at a sentence boundary, then a clause boundary, once
    // we've reached the soft target — keeps cards readable and grammatical.
    const atSoftBoundary = cur.length >= soft && (endsSentence(words[i]) || endsClause(words[i]));
    if (atHardCap || atSoftBoundary) {
      cards.push(cur.join(" "));
      cur = [];
    }
  }
  if (cur.length > 0) {
    // Avoid a lonely 1-2 word final card by merging it back if the previous card
    // has room (keeps it from a single dangling word on its own slide).
    if (cards.length > 0 && cur.length <= 2 && cards[cards.length - 1].split(" ").length + cur.length <= max) {
      cards[cards.length - 1] = cards[cards.length - 1] + " " + cur.join(" ");
    } else {
      cards.push(cur.join(" "));
    }
  }
  return cards;
}

/** Convenience: does this verse need more than one card at the given layout? */
export function needsChunking(text: string, layout: ScriptureChunkLayout, opts: ScriptureChunkOptions = {}): boolean {
  return chunkScripture(text, layout, opts).length > 1;
}
