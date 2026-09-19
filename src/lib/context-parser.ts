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

// "two"/"2"/"five" -> { count } for the multi-verse step patterns; null (pattern falls
// through) for anything that is not a plain number 2..20 ("a"/"one" are the existing
// single-step patterns; 21+ is a mishear, not a command).
function stepCount(word: string): Record<string, unknown> | null {
  const n = spokenToNumber(word);
  return n === null || n < 2 || n > 20 ? null : { count: n };
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
  // "go to verse 17", "go back to verse seven", "go back to seven" — absolute
  // jump to a verse NUMBER. Placed BEFORE the "go back" prev-verse pattern so a
  // numbered "go back to N" jumps to N rather than stepping one verse back. The
  // capture returns null for non-numeric tails ("go back to the Lord"), so the
  // pattern harmlessly falls through to the plain "go back" step in that case.
  { verb: "goto_bible_verse", re: /\bgo\s+(?:back\s+|forward\s+)?to\s+verse\s+([a-z0-9\-]+)\b/i, confidence: 86, capture: (m) => {
    const n = spokenToNumber(m[1]);
    return n === null || n < 1 ? null : { verseNumber: n };
  } },
  { verb: "goto_bible_verse", re: /\bgo\s+back\s+to\s+([a-z0-9\-]+)\b/i, confidence: 80, capture: (m) => {
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

  // Multi-verse steps: "go back two verses", "back up 5 verses",
  // "go forward three verses", "skip ahead 2 verses". The plural noun anchors them (a
  // bare "back"/"forward" stays unmatched; a trailing "two verses back/before" is NOT a
  // command — it is ordinary narration). Payload carries `count` (2..20); the bare
  // "go back" below would otherwise silently step ONE verse for "go back five verses".
  { verb: "prev_verse", re: /\b(?:(?:go|jump|skip|move)\s+back|back\s+up|rewind)\s+(?:by\s+)?([a-z0-9\-]+)\s+verses\b/i, confidence: 90, capture: (m) => stepCount(m[1]) },
  { verb: "next_verse", re: /\b(?:go|jump|skip|move)\s+(?:forward|ahead|on)\s+(?:by\s+)?([a-z0-9\-]+)\s+verses\b/i, confidence: 90, capture: (m) => stepCount(m[1]) },
  { verb: "next_verse", re: /\b(?:skip|advance)(?:\s+ahead)?\s+([a-z0-9\-]+)\s+verses\b/i, confidence: 88, capture: (m) => stepCount(m[1]) },

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
// 2026-08-31 (JPD field recording, rule 9 — African-accent ASR): Deepgram
// mishears the spoken word "verse" in "next verse" as "wrist", "1st", the book
// name "Esther", or close phonetic cousins ("worse", "nurse", "verst"), so a
// genuine "continue to the next verse" arrived as "…next wrist / next 1st /
// next Esther" and matched NO nav pattern — the operator narrated the failure
// on-camera ("I mentioned next verse. It didn't go next verse"). Repair ONLY in
// the unambiguous "(the) next ___" navigation slot so the command still resolves
// to next_verse; a standalone "Esther"/"1st" elsewhere is untouched. "first" is
// deliberately EXCLUDED (too ambiguous — "next first Sunday" etc.).
// The anchor ("next"/"previous"/"prev") disambiguates: only in a relative-nav
// slot do we rewrite the mishearing to "verse". A standalone "Esther"/"1st"
// elsewhere is untouched; "first" is excluded (too ambiguous — "next first
// Sunday"). Symmetric on previous so "go to the previous wrist" also resolves.
const VERSE_MISHEARING_RE = /\b(next|previous|prev)\s+(?:wrist|worse|nurse|verst|1st|esther)\b/gi;
export function repairNavVerseHomophones(text: string): string {
  // Normalise the clipped "prev" → "previous" so the repaired phrase actually
  // matches a prev_verse PATTERN (all of which require the full word "previous").
  return text.replace(VERSE_MISHEARING_RE, (_m, dir: string) =>
    `${/^prev$/i.test(dir) ? "previous" : dir} verse`);
}

// 2026-08-31 (JPD field recording): the operator's voice-nav "standalone guard"
// (ProOperatorShell) rejected any nav utterance over 5 words to avoid firing on
// narration — but a natural spoken command carries politeness + a lead-in that
// blows past 5 ("Continue to the next verse, please." = 6; "Can you continue to
// the next verse please" = 8), so real commands never fired while the terse "go
// back to verse 7" did (the on-camera failure). Count only the COMMAND words:
// strip leading/trailing politeness + filler, THEN apply the terseness gate.
// Genuine narration ("we're gonna see this in the next verse" = 8, no filler to
// strip) still exceeds the limit and stays blocked.
const NAV_FILLER_RE = /\b(?:please|thanks|thank\s+you|okay|ok|alright|all\s+right|so|now|well|yeah|yep|can\s+you|could\s+you|would\s+you|can\s+we|could\s+we|would\s+we|shall\s+we|let's|kindly|just|then|and|hey|oh|erm|um|uh)\b/gi;
export function terseCommandWordCount(text: string): number {
  return text.replace(NAV_FILLER_RE, " ").replace(/[,.?!;:]/g, " ").split(/\s+/).filter(Boolean).length;
}

// 2026-09-14 field fix: the guard counted the WHOLE transcript, so a command
// with a lead-in ("Amen church can we go to next verse please" = 6; "John
// chapter 3 verse 16 can we go to next verse please" = 9) was dropped. Count
// only the TAIL from the nav match onward, and ONLY when (a) the match is an
// ANCHORED nav command (next/previous verse at conf ≥85, "back a/one verse",
// "continue reading") — bare "go back"/"go on"/"continue" keep the whole count —
// and (b) it is immediately preceded by a request lead-in ("can we", "please")
// or a spoken scripture reference. A bare comma/full stop does NOT unlock it.
// Narration ("we're gonna see this in the next verse") stays blocked.
const NAV_ANCHORED_TEXT_RE = /\bback\s+(?:one|a)\s+verse\b|\bcontinue\s+reading\b/i;
const NAV_TAIL_BREAK_RE = /(?:\b(?:can\s+we|could\s+we|would\s+we|shall\s+we|can\s+you|could\s+you|would\s+you|let\s+us|let's|please|kindly|okay|ok|alright)|\d+\s*:\s*\d+|\b(?:verse|chapter)\s+\d+)\s*[,.]?\s*$/i;
// A WHOLE utterance that is nothing but an anchored next/previous-verse command (after
// politeness/filler is stripped) is a command by construction — narration can't match
// it because every word must belong to the command. Counted as 2 so a natural lead-in
// ("let's move on to the next verse", "take us to the next verse", "show me the next
// verse please") is never dropped by the 5-word standalone guard.
const PURE_LEAD = "(?:go|move|jump|skip|turn|proceed|carry|scroll|read|show|bring)(?:\\s+(?:me|us|on|up))?(?:\\s+(?:to|onto))?|take\\s+us\\s+to|give\\s+us|have|on\\s+to|onto";
const PURE_NAV_RE = new RegExp(`^(?:(?:${PURE_LEAD})\\s+)?(?:(?:the|me|us)\\s+)*(?:next|previous|following)\\s+(?:verse|one)$`, "i");
export function isPureNavCommand(text: string): boolean {
  const t = repairNavVerseHomophones(text).replace(NAV_FILLER_RE, " ").replace(/[,.?!;:]/g, " ").replace(/\s+/g, " ").trim();
  return PURE_NAV_RE.test(t);
}

export function navCommandWordCount(
  text: string,
  cmd: { verb: string; confidence: number; matchedText?: string } | null | undefined,
): number {
  if (isPureNavCommand(text)) return 2;
  const whole = terseCommandWordCount(text);
  const matchedText = cmd?.matchedText;
  if (!cmd || !matchedText) return whole;
  const anchored =
    ((cmd.verb === "next_verse" || cmd.verb === "prev_verse") && cmd.confidence >= 85) ||
    NAV_ANCHORED_TEXT_RE.test(matchedText);
  if (!anchored) return whole;
  const repaired = repairNavVerseHomophones(text);
  const idx = repaired.toLowerCase().indexOf(matchedText.toLowerCase());
  if (idx <= 0) return whole;
  const prefix = repaired.slice(0, idx);
  if (!NAV_TAIL_BREAK_RE.test(prefix)) return whole;
  return Math.min(whole, terseCommandWordCount(repaired.slice(idx)));
}

export function parseContextCommand(text: string, available: ContextAvailability): ContextCommand | null {
  text = repairNavVerseHomophones(text);
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
