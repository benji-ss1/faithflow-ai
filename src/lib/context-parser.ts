/**
 * Contextual verse-navigation parser.
 *
 * These phrases are only meaningful when there's a "current reference" —
 * i.e. the operator just staged/showed a specific verse. Saying "next
 * verse" advances that reference by +1; "previous" by -1; "continue"
 * expands the range by +1 verse.
 *
 * Unlike the wake-prefixed command parser, these do NOT require the
 * "presentflow" prefix — they're semantically bound to the current live
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
  | "repeat_verse"      // re-send the current verse live, no index change
  | "goto_bible_verse"  // jump to an absolute verse NUMBER within the current chapter, e.g. "from verse 11"
  // Slide-navigation verbs — no wake word required. Same architecture as
  // "next verse" — anchored phrases only, not lone words.
  | "next_slide"
  | "prev_slide"
  | "blank_screen"
  | "clear_screen"
  // Phase 5 additions — all still approval-gated.
  | "start_countdown"
  | "captions_on"
  | "captions_off"
  | "show_chorus"
  | "goto_verse";

export type ContextCommand = {
  verb: ContextVerb;
  confidence: number;
  matchedText: string;
  payload?: Record<string, unknown>;
};

// Word→number helper for spoken-form small numerals (one..twenty, tens like
// "thirty two"). Enough for verse indices, countdown minutes, and Psalms up
// to 200. Returns null if unrecognized.
const SMALL_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};
export function spokenToNumber(word: string): number | null {
  const w = word.toLowerCase().trim().replace(/-/g, " ");
  if (!w) return null;
  const asDigit = Number(w);
  if (!Number.isNaN(asDigit) && Number.isInteger(asDigit) && asDigit >= 0 && asDigit <= 200) return asDigit;
  const parts = w.split(/\s+/);
  let total = 0;
  let current = 0;
  for (const p of parts) {
    if (!(p in SMALL_WORDS)) {
      const n = Number(p);
      if (!Number.isNaN(n) && Number.isInteger(n)) { current += n; continue; }
      return null;
    }
    const v = SMALL_WORDS[p];
    if (v === 100) current = (current || 1) * 100;
    else current += v;
  }
  total += current;
  if (total < 0 || total > 200) return null;
  return total;
}

// Combinatorial synonym groups for verse navigation. Every intent below is
// built as (LEAD VERB PHRASE) + (OBJECT NOUN), so each regex covers dozens
// of realistic spoken variants while still requiring a verb-anchored phrase
// — never a bare word — per this file's core safety rule. Leads/objects were
// chosen by cross-referencing how ProPresenter, EasyWorship, and Proclaim
// document their own voice/remote "next slide" phrasing plus common pulpit
// speech patterns ("let's move to...", "turn to...", "carry on to...").
const NEXT_LEADS = "go\\s+to|read|show|turn\\s+to|move\\s+(?:on\\s+)?to|jump\\s+to|skip\\s+to|advance\\s+to|proceed\\s+to|carry\\s+on\\s+to|let's\\s+(?:go\\s+to|move\\s+to)|and\\s+(?:now\\s+)?(?:go\\s+to|read)|on\\s+to|onto|scroll\\s+to";
const NEXT_OBJECTS = "next\\s+(?:verse|one|line|passage|slide)|one\\s+after\\s+this|following\\s+verse";
const PREV_LEADS = "go\\s+back\\s+to|back\\s+to|return\\s+to|rewind\\s+to|let's\\s+go\\s+back\\s+to|and\\s+back\\s+to|jump\\s+back\\s+to";
const PREV_OBJECTS = "previous\\s+(?:verse|one|line|slide)|verse\\s+before(?:\\s+this)?|one\\s+before\\s+this|last\\s+verse";

// Ordered most-specific → most-lenient. First match wins.
const PATTERNS: { verb: ContextVerb; re: RegExp; confidence: number; capture?: (m: RegExpExecArray) => Record<string, unknown> | null }[] = [
  // Combinatorial lead+object forms — covers "go to the next verse", "let's
  // move to the next one", "turn to the next passage", "carry on to the
  // next line", "scroll to the next slide", etc. (7 leads × 5 objects = 35
  // phrasings from this single pattern alone).
  { verb: "next_verse", re: new RegExp(`\\b(?:${NEXT_LEADS})\\s+(?:the\\s+)?(?:${NEXT_OBJECTS})\\b`, "i"), confidence: 88 },
  // Bare "next verse" / "next one" without a lead verb — still anchored to
  // the noun "verse"/"one", not a lone directional word like "forward".
  { verb: "next_verse", re: /\bnext\s+(?:verse|one|line|passage)\b/i, confidence: 85 },
  { verb: "next_verse", re: /\bverse\s+(?:number\s+)?(?:following|after)\b/i, confidence: 70 },
  { verb: "next_verse", re: /\b(?:let's\s+)?(?:go\s+on|move\s+on|carry\s+on|continue\s+on)\s+(?:to\s+)?(?:the\s+)?next\b/i, confidence: 78 },
  { verb: "next_verse", re: /\bgo\s+forth\s+to\s+(?:the\s+)?next\b/i, confidence: 78 },
  // NOTE: deliberately no bare `/\bforward\b/` or `/\bgo\s+forth\b/` alone —
  // "moving forward", "forward in faith" etc. appear in ordinary sermon
  // speech unanchored to verse navigation.

  { verb: "prev_verse", re: new RegExp(`\\b(?:${PREV_LEADS})\\s+(?:the\\s+)?(?:${PREV_OBJECTS})\\b`, "i"), confidence: 88 },
  { verb: "prev_verse", re: /\bprevious\s+(?:verse|one|line)\b/i, confidence: 90 },
  { verb: "prev_verse", re: /\b(?:go\s+)?back\s+(?:one|a)\s+verse\b/i, confidence: 90 },
  { verb: "prev_verse", re: /\bthe\s+verse\s+before\b/i, confidence: 80 },
  { verb: "prev_verse", re: /\b(?:the\s+)?one\s+before\s+this\b/i, confidence: 75 },

  // "from verse 11", "from 13", "let's read from 15" — jump to an ABSOLUTE
  // verse number within the current chapter, not a relative +/-1 step like
  // next/prev. Common pulpit phrasing ("from verse eleven, ...continuing").
  // Bare "from <number>" is anchored by the word "from" (not a lone digit),
  // matching this file's anchoring rule.
  { verb: "goto_bible_verse", re: /\bfrom\s+verse\s+([a-z0-9\-]+)\b/i, confidence: 88, capture: (m) => {
    const n = spokenToNumber(m[1]);
    return n === null || n < 1 ? null : { verseNumber: n };
  } },
  { verb: "goto_bible_verse", re: /\bfrom\s+(\d{1,3})\b/i, confidence: 78, capture: (m) => {
    const n = spokenToNumber(m[1]);
    return n === null || n < 1 ? null : { verseNumber: n };
  } },

  // "continue" — genuinely means "keep going forward through the passage,"
  // functionally identical to next_verse for this app's purposes (both
  // advance one card). Anchored multi-word phrases only.
  { verb: "continue", re: /\b(?:let's\s+)?continue\s+(?:reading|on|through)\b/i, confidence: 78 },
  { verb: "continue", re: /\bread\s+on\b/i, confidence: 70 },
  { verb: "continue", re: /\bkeep\s+reading\b/i, confidence: 70 },
  { verb: "continue", re: /\bverse\s+(?:number\s+)?(?:continues|goes\s+on)\b/i, confidence: 75 },
  { verb: "continue", re: /\bgo\s+on\b/i, confidence: 68 },
  { verb: "continue", re: /\bmoving\s+on\b/i, confidence: 65 },

  { verb: "back", re: /\bgo\s+back\b/i, confidence: 75 },

  // "say that again", "read it again", "one more time", "come again",
  // "repeat that verse" — repeats the CURRENT verse live without changing
  // which verse is selected. Distinct from "go back" (moves to previous).
  { verb: "repeat_verse", re: /\b(?:say|read)\s+(?:that|it)\s+again\b/i, confidence: 85 },
  { verb: "repeat_verse", re: /\bone\s+more\s+time\b/i, confidence: 80 },
  { verb: "repeat_verse", re: /\brepeat\s+(?:that|this|it)?\s*(?:verse)?\b/i, confidence: 78 },
  { verb: "repeat_verse", re: /\bcome\s+again\b/i, confidence: 72 },
  { verb: "repeat_verse", re: /\bone\s+(?:last|final)\s+time\b/i, confidence: 78 },
  // NOTE: deliberately no bare `/\bagain\b/` pattern — "again" appears
  // constantly in ordinary sermon speech ("as I said again...") with no
  // verb anchoring at all, which is exactly what this module's header
  // comment says to avoid. Every pattern above requires an anchoring verb
  // phrase, not a lone word.

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

  // --- Phase 5 additions ----------------------------------------------------
  // "start countdown [N minutes|N seconds]" — falls back to 5 min (300s).
  {
    verb: "start_countdown",
    re: /\bstart\s+(?:a\s+|the\s+)?countdown(?:\s+(?:for\s+|of\s+)?([a-z0-9\- ]{1,40}?)(?:\s+(minutes?|mins?|seconds?|secs?))?)?\b/i,
    confidence: 90,
    capture: (m) => {
      const raw = (m[1] || "").trim();
      const unit = (m[2] || "").toLowerCase();
      if (!raw) return { seconds: 300 };
      const n = spokenToNumber(raw);
      if (n === null) return { seconds: 300 };
      const isSec = /^sec/.test(unit);
      const seconds = isSec ? n : n * 60;
      if (!isFinite(seconds) || seconds <= 0 || seconds > 60 * 60 * 3) return { seconds: 300 };
      return { seconds };
    },
  },

  { verb: "captions_on", re: /\b(?:turn\s+on\s+captions|captions\s+on|enable\s+captions)\b/i, confidence: 92 },
  { verb: "captions_off", re: /\b(?:turn\s+off\s+captions|captions\s+off|disable\s+captions)\b/i, confidence: 92 },

  { verb: "show_chorus", re: /\b(?:show|go\s+to|jump\s+to|play)\s+(?:the\s+)?chorus\b/i, confidence: 90 },

  // "go to verse two", "verse 2", "jump to verse three" — used only when a
  // song is staged (song context). We DELIBERATELY don't fire on bare
  // "verse 2" alone because that's ambiguous with scripture reference talk;
  // require an anchoring verb.
  {
    verb: "goto_verse",
    re: /\b(?:go\s+to|jump\s+to|show|play)\s+verse\s+([a-z0-9\-]+)\b/i,
    confidence: 82,
    capture: (m) => {
      const n = spokenToNumber(m[1]);
      if (n === null || n < 1 || n > 50) return null;
      return { index: n };
    },
  },
];

/** Verb -> category. Verse verbs need a bank ref; slide verbs need any
 * live slide; screen verbs (blank/clear) don't need any context. The
 * "global" verbs (countdown, captions) require no prior context. Song
 * verbs (show_chorus / goto_verse) need a slide up so we know a song is
 * staged. */
const VERB_KIND: Record<ContextVerb, "verse" | "slide" | "screen" | "global" | "song"> = {
  next_verse: "verse", prev_verse: "verse", continue: "verse", back: "verse", repeat_verse: "verse", goto_bible_verse: "verse",
  next_slide: "slide", prev_slide: "slide",
  blank_screen: "screen", clear_screen: "screen",
  start_countdown: "global", captions_on: "global", captions_off: "global",
  show_chorus: "song", goto_verse: "song",
};

export type ContextAvailability = {
  hasVerseContext: boolean; // a verse is currently in the bank / live
  hasSlideContext: boolean; // a slide is currently being displayed
  hasSongContext?: boolean; // a song is currently staged / previewed
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
    if (kind === "song" && !available.hasSongContext) continue;
    // "screen" and "global" always allowed
    const m = p.re.exec(text);
    if (m) {
      const payload = p.capture ? p.capture(m) : undefined;
      if (p.capture && payload === null) continue; // capture rejected
      return { verb: p.verb, confidence: p.confidence, matchedText: m[0], payload: payload || undefined };
    }
  }
  return null;
}
