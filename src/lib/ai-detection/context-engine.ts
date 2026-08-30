// Contextual Awareness Engine — the rolling state model on top of the per-
// utterance lexicon scorer (context-lexicons.ts). Pure, framework-free, no I/O —
// constructed and held by the caller (useAudioStream) as a ref, exactly like
// SuggestionDedupe / decideBibleAutoFire, so it is directly unit-testable.
//
// It answers one question for the detection gates: "what KIND of speech is
// happening right now?" — smoothed across a rolling window with hysteresis, so a
// single stray word (one "hallelujah" in a sermon, one narrative aside during
// prayer) can't flip the classification. The primary Phase-1 signal is
// `isSpokenContext`: when the moment is confidently PRAYER / SCRIPTURE-READING /
// PREACHING / ANNOUNCEMENT (and NOT singing), a "song" match is almost certainly
// a spoken worship-adjacent phrase ("in the mighty name of Jesus", "king of
// kings") and must be held at chip-tier, never zero-clicked to the projector.
//
// It NEVER raises a confidence or fires anything — it only exposes signals the
// existing gates consume to DOWNGRADE (cap to chip) or HOLD. Latency: one O(tokens)
// regex sweep per utterance at runDetectAll cadence, no allocation beyond the
// snapshot, no network (rule 10).

import {
  scoreSpeechClasses,
  SPEECH_CLASSES,
  type ClassScores,
  type LexiconSignals,
  type SpeechClass,
} from "./context-lexicons";

const ALPHA = 0.45;          // EWMA weight of the newest utterance
const WINDOW = 8;            // ring-buffer size (~30s of speech)
const HYSTERESIS = 0.12;     // a challenger must beat the incumbent EWMA by this to take over
const SPOKEN_MIN = 0.30;     // dominant-EWMA floor to trust a spoken context
const WORSHIP_GUARD = 0.30;  // if worship EWMA >= this, we do NOT treat it as spoken (protect real songs)
const PRAYER_CTX_MIN = 0.32;
const STORY_CTX_MIN = 0.32;
const READING_CTX_MIN = 0.32;
const REPEAT_WINDOW_MS = 45_000; // how long a reference is remembered for repeat detection

const SPOKEN_CLASSES: SpeechClass[] = ["prayer", "scripture_reading", "preaching", "announcement"];

export type LiveKind = "scripture" | "song" | "empty";

export type ContextSnapshot = {
  dominant: SpeechClass;
  confidence: number;        // EWMA of the dominant class, 0..1
  dwellMs: number;           // how long we've held this dominant class
  prayerStreak: number;      // consecutive prayer-leaning utterances
  isPrayerContext: boolean;
  isStoryContext: boolean;
  isScriptureReadingContext: boolean;
  isWorshipContext: boolean;
  /** The Phase-1 gate: a confidently SPOKEN moment (prayer/reading/preaching/
   * announcement) that is NOT singing — a "song" match here is almost certainly a
   * spoken worship-adjacent phrase and should be capped to chip-tier, not fired. */
  isSpokenContext: boolean;
  liveKind: LiveKind;
};

/** Whether a re-detected reference is the first mention, an incidental repeat
 * (buried in a non-scripture-reading context while it's already live — a preacher
 * merely restating), or a deliberate restatement worth re-projecting. */
export type RepeatKind = "first" | "incidental-repeat" | "deliberate-restatement";

export type ObserveInput = {
  text: string;
  now: number;
  signals?: LexiconSignals;
  live?: { kind: LiveKind; refKey?: string };
};

function zeroScores(): ClassScores {
  return { prayer: 0, scripture_reading: 0, preaching: 0, worship: 0, nav: 0, announcement: 0 };
}
function argmax(s: ClassScores): SpeechClass {
  let best: SpeechClass = "announcement";
  let bestV = -Infinity;
  for (const c of SPEECH_CLASSES) {
    if (s[c] > bestV) { bestV = s[c]; best = c; }
  }
  return best;
}

export class ContextEngine {
  private ewma: ClassScores = zeroScores();
  private dominant: SpeechClass = "announcement";
  private dominantSince = 0;
  private prayerStreak = 0;
  private ring: Array<{ ts: number; scores: ClassScores }> = [];
  private recentRefs = new Map<string, { count: number; firstAt: number; lastAt: number }>();
  private live: { kind: LiveKind; refKey?: string } = { kind: "empty" };
  private lastNow = 0;

  /** Reset all state — call wherever the detection session resets (church switch,
   * pipeline restart), alongside the dedupe ref. */
  reset(): void {
    this.ewma = zeroScores();
    this.dominant = "announcement";
    this.dominantSince = 0;
    this.prayerStreak = 0;
    this.ring = [];
    this.recentRefs.clear();
    this.live = { kind: "empty" };
    this.lastNow = 0;
  }

  /** Observe one finalized/accepted utterance and return the updated snapshot. */
  observe(input: ObserveInput): ContextSnapshot {
    const { text, now } = input;
    this.lastNow = now;
    if (input.live) this.live = input.live;

    const scores = scoreSpeechClasses(text, input.signals);
    for (const c of SPEECH_CLASSES) {
      this.ewma[c] = ALPHA * scores[c] + (1 - ALPHA) * this.ewma[c];
    }
    this.ring.push({ ts: now, scores });
    if (this.ring.length > WINDOW) this.ring.shift();

    this.prayerStreak = scores.prayer >= 0.4 ? this.prayerStreak + 1 : 0;

    const challenger = argmax(this.ewma);
    if (challenger !== this.dominant && this.ewma[challenger] >= this.ewma[this.dominant] + HYSTERESIS) {
      this.dominant = challenger;
      this.dominantSince = now;
    } else if (this.dominantSince === 0) {
      this.dominantSince = now; // first observation
    }
    return this.snapshot();
  }

  /** Record that a scripture reference was just detected (call from the caller
   * when a ref surfaces), so refJustRepeated can classify future repeats. */
  noteRef(refKey: string, now: number): void {
    // prune stale
    for (const [k, v] of this.recentRefs) {
      if (now - v.lastAt > REPEAT_WINDOW_MS) this.recentRefs.delete(k);
    }
    const prev = this.recentRefs.get(refKey);
    if (prev) { prev.count += 1; prev.lastAt = now; }
    else this.recentRefs.set(refKey, { count: 1, firstAt: now, lastAt: now });
  }

  /** Classify a re-detection of `refKey`: a repeat of the CURRENTLY-LIVE verse
   * buried inside a spoken (non-reading) context is 'incidental-repeat' (hold);
   * a restatement while reading, or of a ref that isn't live, is deliberate. */
  refJustRepeated(refKey: string): RepeatKind {
    const rec = this.recentRefs.get(refKey);
    if (!rec || rec.count <= 1) return "first";
    const isLive = this.live.kind === "scripture" && this.live.refKey === refKey;
    const readingNow = this.ewma.scripture_reading >= READING_CTX_MIN;
    if (isLive && !readingNow) return "incidental-repeat";
    return "deliberate-restatement";
  }

  snapshot(): ContextSnapshot {
    const confidence = this.ewma[this.dominant];
    const dwellMs = this.dominantSince ? Math.max(0, this.lastNow - this.dominantSince) : 0;
    const isPrayerContext = this.ewma.prayer >= PRAYER_CTX_MIN;
    const isStoryContext = this.dominant === "preaching" && this.ewma.preaching >= STORY_CTX_MIN;
    const isScriptureReadingContext = this.ewma.scripture_reading >= READING_CTX_MIN;
    const isWorshipContext = this.ewma.worship >= WORSHIP_GUARD;
    const isSpokenContext =
      SPOKEN_CLASSES.includes(this.dominant) &&
      confidence >= SPOKEN_MIN &&
      this.ewma.worship < WORSHIP_GUARD; // never treat active singing as "spoken"
    return {
      dominant: this.dominant,
      confidence,
      dwellMs,
      prayerStreak: this.prayerStreak,
      isPrayerContext,
      isStoryContext,
      isScriptureReadingContext,
      isWorshipContext,
      isSpokenContext,
      liveKind: this.live.kind,
    };
  }
}
