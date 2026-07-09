/**
 * Contextual verse-navigation parser.
 *
 * These phrases are only meaningful when there's a "current reference" —
 * i.e. the operator just staged/showed a specific verse. Saying "next
 * verse" advances that reference by +1; "previous" by -1; "continue"
 * expands the range by +1 verse.
 *
 * Unlike the wake-prefixed command parser, these do NOT require the
 * "faithflow" prefix — they're semantically bound to the current live
 * reference, so a pastor's natural speech pattern is enough. But that
 * makes false positives possible, so:
 *
 *   1. They only fire when currentRef is non-null (there's context)
 *   2. Phrases require verb-like anchoring ("go to", "let's read",
 *      "the next", "verse", "read on") to avoid catching random words
 *   3. They're still approval-gated in the panel unless auto-approve
 *      mode is on
 */

export type ContextVerb =
  | "next_verse"
  | "prev_verse"
  | "continue"          // extend current range by +1
  | "back"              // shrink current range by -1
  // Slide-navigation verbs — no wake word required. Same architecture as
  // "next verse" — anchored phrases only, not lone words.
  | "next_slide"
  | "prev_slide"
  | "blank_screen"
  | "clear_screen";

export type ContextCommand = {
  verb: ContextVerb;
  confidence: number;
  matchedText: string;
};

// Ordered most-specific → most-lenient. First match wins.
const PATTERNS: { verb: ContextVerb; re: RegExp; confidence: number }[] = [
  // "let's go to the next verse", "and the next verse says"
  { verb: "next_verse", re: /\b(?:go\s+to|read|show|and)\s+(?:the\s+)?next\s+(?:verse|one)\b/i, confidence: 90 },
  { verb: "next_verse", re: /\bnext\s+verse\b/i, confidence: 85 },
  { verb: "next_verse", re: /\bthe\s+next\s+(?:passage|line)\b/i, confidence: 75 },
  { verb: "next_verse", re: /\bverse\s+(?:number\s+)?(?:following|after)\b/i, confidence: 70 },

  { verb: "prev_verse", re: /\bprevious\s+verse\b/i, confidence: 90 },
  { verb: "prev_verse", re: /\b(?:go\s+)?back\s+(?:one|a)\s+verse\b/i, confidence: 90 },
  { verb: "prev_verse", re: /\bthe\s+verse\s+before\b/i, confidence: 80 },

  { verb: "continue", re: /\b(?:let's\s+|and\s+)?(?:read|continue\s+reading|read\s+on|keep\s+reading)\b/i, confidence: 55 },
  { verb: "continue", re: /\bverse\s+(?:number\s+)?(?:continues|goes\s+on)\b/i, confidence: 75 },

  { verb: "back", re: /\bgo\s+back\b/i, confidence: 60 },

  // --- Slide navigation (wake-word-free) ------------------------------------
  // Only fire when there's context (i.e. a slide is currently live) — same
  // constraint as the verse commands. Anchored phrases only.
  { verb: "next_slide", re: /\b(?:let's\s+)?(?:go\s+to\s+the\s+|move\s+(?:on\s+)?to\s+the\s+)?next\s+slide\b/i, confidence: 92 },
  { verb: "next_slide", re: /\b(?:let's|shall\s+we)\s+(?:move\s+on|continue\s+on)\b/i, confidence: 70 },
  { verb: "next_slide", re: /\bmoving\s+on\b/i, confidence: 65 },

  { verb: "prev_slide", re: /\b(?:go\s+to\s+the\s+)?previous\s+slide\b/i, confidence: 92 },
  { verb: "prev_slide", re: /\bgo\s+back\s+(?:one|a)\s+slide\b/i, confidence: 90 },
  { verb: "prev_slide", re: /\bthe\s+last\s+slide\b/i, confidence: 65 },

  { verb: "blank_screen", re: /\b(?:let's\s+)?(?:blank|hide)\s+the\s+screen\b/i, confidence: 92 },
  { verb: "blank_screen", re: /\b(?:turn|take)\s+(?:off|down)\s+the\s+screen\b/i, confidence: 85 },

  { verb: "clear_screen", re: /\b(?:let's\s+)?clear\s+the\s+screen\b/i, confidence: 92 },
];

/** Verb -> category. Verse verbs need a bank ref; slide verbs need any
 * live slide; screen verbs (blank/clear) don't need any context. */
const VERB_KIND: Record<ContextVerb, "verse" | "slide" | "screen"> = {
  next_verse: "verse", prev_verse: "verse", continue: "verse", back: "verse",
  next_slide: "slide", prev_slide: "slide",
  blank_screen: "screen", clear_screen: "screen",
};

export type ContextAvailability = {
  hasVerseContext: boolean; // a verse is currently in the bank / live
  hasSlideContext: boolean; // a slide is currently being displayed
};

/**
 * Detect a contextual navigation command. The available-context flags
 * gate which verbs can fire — a bare "next slide" only counts when a
 * slide is currently up; a "blank the screen" fires anytime because it's
 * a destination state, not a delta.
 *
 * This is the wake-word-free path: same architecture as the mid-sentence
 * Bible detection — pattern-match the intent, don't require a prefix.
 */
export function parseContextCommand(text: string, available: ContextAvailability): ContextCommand | null {
  for (const p of PATTERNS) {
    const kind = VERB_KIND[p.verb];
    if (kind === "verse" && !available.hasVerseContext) continue;
    if (kind === "slide" && !available.hasSlideContext) continue;
    // "screen" always allowed
    const m = p.re.exec(text);
    if (m) return { verb: p.verb, confidence: p.confidence, matchedText: m[0] };
  }
  return null;
}
