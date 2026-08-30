// Context-engine lexicons — the fast, deterministic per-utterance scorer that
// classifies live church speech into six classes. Grounded in a REAL JPD service
// transcript (Deepgram nova-2, the same model the live bridge uses), NOT idealized
// text (CLAUDE.md rule 9). Examples that shaped these patterns, verbatim:
//   PRAYER            "Lord Jesus Christ, we thank you again for your goodness … You are worthy. You are holy forever."
//   SCRIPTURE_READING "In Isaiah chapter six, the prophet Isaiah sees … holy, holy, holy is the lord of heaven's armies."
//   PREACHING/STORY   "I got the privilege to go to a United game on Wednesday … there were about 80,000 … what happened was …"
//   WORSHIP/SINGING   "I need a rescue. My sin was heavy. But chains break at the weight of your glory." / repeated "Hallelujah."
//   ANNOUNCEMENT      "I want us to take about five seconds to look at your neighbour, congratulate them …"
//   NAV               "next verse" / "go back" / "chorus" (delegated to context-parser upstream)
//
// The whole point: worship-ADJACENT phrases ("king of kings", "Lord of lords",
// "praise the Lord", "Hallelujah", "holy holy holy") occur constantly in PRAYER,
// SCRIPTURE-READING and PREACHING here — so a naive song matcher fires on them.
// Scoring is pure regex `.test()`/counting — no allocation-heavy work, no LLM,
// no network — so it stays on the hot path within the rule-10 latency budget.

export type SpeechClass =
  | "prayer"
  | "scripture_reading"
  | "preaching"
  | "worship"
  | "nav"
  | "announcement";

export const SPEECH_CLASSES: SpeechClass[] = [
  "prayer",
  "scripture_reading",
  "preaching",
  "worship",
  "nav",
  "announcement",
];

export type ClassScores = Record<SpeechClass, number>; // each 0..1

/** External signals the caller already computed, folded into scoring so the
 * lexicon doesn't re-derive them. All optional — the text-only scan works alone. */
export type LexiconSignals = {
  /** parseReferences() found an explicit Book chapter:verse — strong scripture. */
  hasScriptureRef?: boolean;
  /** best lyric-fragment match score 0..100 from the song engine — strong worship. */
  lyricMatchScore?: number;
  /** audio watchdog thinks we're in sung music (low ASR conf while audible). */
  musicSuspected?: boolean;
  /** context-parser matched a navigation command. */
  navHit?: boolean;
};

const words = (t: string) => t.toLowerCase().replace(/[^a-z0-9'\s]/g, " ").split(/\s+/).filter(Boolean);
const has = (re: RegExp, t: string) => (re.test(t) ? 1 : 0);
const count = (re: RegExp, t: string) => (t.match(re) || []).length;
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

// ── PRAYER ──────────────────────────────────────────────────────────────────
// Direct 2nd-person address TO God + benediction/invocation vocabulary. This is
// the class that must fire so "in the mighty name of Jesus" can't project a song.
const PRAYER_STRONG = /\b(lord jesus( christ)?|father (lord|god)|holy spirit|dear (lord|god|father)|in the (mighty )?name of jesus|in jesus'? name|we (thank|bless|worship|magnify|exalt) you|thank you (lord|jesus|father)|we pray|i (declare|decree)|hallelujah|amen)\b/;
const PRAYER_ADDRESS = /\byou are (worthy|holy|good|great|god|lord|the)\b|\byour (name|goodness|mercy|mercies|glory|presence|grace)\b|\bwe (come|bow|surrender|lift)\b/g;

// ── SCRIPTURE_READING ────────────────────────────────────────────────────────
// Reading / expounding a passage: reference cadence + reading markers + quoting.
const SCRIPTURE_MARK = /\b(in ([1-3]?\s?[a-z]+) chapter|chapter \w+|verse \w+|the prophet \w+|the (bible|word|scripture|scriptures?|psalmist|apostle) (says?|said|tells?|writes?|declares?)|it (says|reads|tells)|according to|as it is written|turn (with me )?to|let us (turn|read)|the book of|thus says the lord)\b/;

// ── PREACHING / STORYTELLING ─────────────────────────────────────────────────
// First-person past-tense narration + discourse markers. The football-story class.
const STORY_MARK = /\b(i (got|went|was|had|remember|saw|asked|said|told|met|used to)|there (was|were)|what happened( was)?|let me (tell|take|show|explain)|so (basically|historically|when|then|i|the)|on (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|the other day|one day|you see|you know what i mean|somebody('?s)? |are you with me|let me tell you|as i was)\b/;
const STORY_PAST = /\b\w+(ed|ted|ded)\b|\b(went|saw|got|had|was|were|came|took|said|told|made|knew|gave|felt|found)\b/g;

// ── ANNOUNCEMENT / TRANSITION / EXHORTATION ──────────────────────────────────
// Logistics, greetings, congregation direction. Low-stakes; mostly suppresses.
const ANNOUNCE_MARK = /\b(welcome|good (morning|evening|afternoon)|(please )?(stand|sit|rise)( up| to your feet)?|turn to your (neighbou?r|neighbor)|congratulate|shake (someone'?s|their) hand|offering|announcement|next (week|section|song|slide)|this (morning|evening)|we're gonna (sing|do|sing a)|let us (all )?(stand|clap|worship|sing)|i want us to|clap offering|for the next (five|ten|few)|everybody (on|leaps|say|clap)|one two three four)\b/;

// ── WORSHIP / SINGING ────────────────────────────────────────────────────────
// Hard from text alone — the strongest signal is the audio (musicSuspected) +
// lyric-match score. Textual tells: repeated "hallelujah", short poetic fragments
// with heavy 1st/2nd-person + no narrative verbs, refrain repetition.
const WORSHIP_MARK = /\b(hallelujah|glory to god|worthy is the lamb|holy holy holy|we (worship|magnify|adore)|king of (all )?kings|lord of lords|to the (king|one|lamb|god))\b/;

/**
 * Score all six classes for a single utterance. Each score is 0..1. Scores are
 * NOT normalized to sum to 1 — the rolling engine (context-engine.ts) smooths
 * and picks a dominant class with hysteresis. Returns a fresh object each call.
 */
export function scoreSpeechClasses(text: string, signals: LexiconSignals = {}): ClassScores {
  const t = ` ${text.toLowerCase()} `;
  const w = words(text);
  const n = Math.max(1, w.length);

  // PRAYER: strong invocation marker OR dense 2nd-person-to-God address.
  const prayerAddr = count(PRAYER_ADDRESS, t);
  const prayer = clamp01(
    0.7 * has(PRAYER_STRONG, t) +
    0.5 * Math.min(1, prayerAddr / 2) +
    // short utterance that is essentially just the invocation weighs more
    (has(PRAYER_STRONG, t) && n <= 8 ? 0.3 : 0),
  );

  // SCRIPTURE_READING: explicit ref (from signals) dominates; reading markers add.
  const scripture_reading = clamp01(
    (signals.hasScriptureRef ? 0.75 : 0) +
    0.5 * has(SCRIPTURE_MARK, t),
  );

  // PREACHING/STORY: narrative markers + past-tense density.
  const pastDensity = count(STORY_PAST, t) / n;
  const preaching = clamp01(
    0.55 * has(STORY_MARK, t) +
    0.7 * Math.min(1, pastDensity / 0.18) * (n >= 8 ? 1 : 0.4),
  );

  // ANNOUNCEMENT: logistics/greeting/direction markers.
  const announcement = clamp01(0.7 * has(ANNOUNCE_MARK, t));

  // WORSHIP: audio + lyric-match lead; text is a weak secondary.
  const lyric = (signals.lyricMatchScore ?? 0) / 100;
  const halleluCount = count(/\bhallelujah\b/g, t);
  const worship = clamp01(
    (signals.musicSuspected ? 0.6 : 0) +
    0.6 * Math.min(1, lyric / 0.6) +
    0.4 * has(WORSHIP_MARK, t) +
    (halleluCount >= 2 ? 0.3 : 0),
  );

  // NAV: delegated — the caller passes navHit from context-parser.
  const nav = signals.navHit ? 1 : 0;

  return { prayer, scripture_reading, preaching, worship, nav, announcement };
}
