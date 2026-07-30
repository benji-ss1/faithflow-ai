/**
 * Bible auto-fire anti-replay guard (extracted for direct test coverage).
 *
 * Background (see CLAUDE.md rule 7, 2026-07-30 note):
 *   Preachers legitimately re-preach the same verse throughout a sermon —
 *   "Psalm 23:4" cited three times over 20 minutes MUST re-project each
 *   time, not just the first. The old session-persistent 5-minute
 *   suppression window blocked that. The current policy is a tight
 *   micro-cooldown: only suppress if the SAME reference re-arrives within
 *   ~3 seconds, which absorbs Deepgram interim/final/whisper duplicate
 *   detections for a single utterance without ever swallowing a legit
 *   restatement later in the message.
 *
 * The sessionStorage schema is preserved so admin/analytics readers keep
 * working — this helper is the timing authority (any entry older than
 * BIBLE_MICRO_COOLDOWN_MS is treated as expired even if it's still in the
 * map). Guards BYPASS entirely when the CURRENTLY-LIVE slide is a
 * DIFFERENT scripture reference (a legit swap-back scenario), or when the
 * detection carries `forceLive` / `voiceCommand` (explicit operator/preacher
 * intent).
 *
 * Song anti-replay (`SONG_AUTO_FIRED_SESSION_KEY`) is UNCHANGED at 5 min —
 * songs are structurally different (a whole worship set gets sung, then
 * usually doesn't come back for 40 min). This helper is Bible-only.
 */

/** How long a same-reference re-fire is suppressed. 3s absorbs one utterance's
 * worth of interim → final → whisper duplicate detections without ever
 * swallowing a legitimate second citation of the same verse. */
export const BIBLE_MICRO_COOLDOWN_MS = 3_000;

/** Parsed canonical reference of a Bible slide currently on the projector. */
export type LiveScriptureRef = {
  book: string;      // lowercased, single-spaced
  chapter: number;
  verseStart: number;
  verseEnd: number;
};

/** Parse the trailing "Book C:V(-Ve) (CODE)" label off a live slide's text.
 * Returns null when the live slide isn't a Bible verse (song, blank, image,
 * message overlay, or scripture with reference display turned off). */
export function parseLiveScriptureRef(liveText: string | null | undefined): LiveScriptureRef | null {
  if (!liveText) return null;
  const m = liveText.match(/(\d?\s*[A-Za-z]+)\s+(\d+):(\d+)(?:-(\d+))?\s*\([A-Za-z0-9]+\)\s*$/);
  if (!m) return null;
  const verseStart = parseInt(m[3], 10);
  const verseEnd = m[4] ? parseInt(m[4], 10) : verseStart;
  return {
    book: m[1].trim().toLowerCase().replace(/\s+/g, " "),
    chapter: parseInt(m[2], 10),
    verseStart,
    verseEnd,
  };
}

/** True when the currently-live slide is a DIFFERENT scripture (or is not
 * scripture at all — song lyric / image / blank). Permissive default:
 * treat non-scripture-live and unparseable-live as "different", because
 * those states are legitimate content swaps. */
export function isDifferentRefLive(
  liveText: string | null | undefined,
  target: { book: string; chapter: number; verseStart: number; verseEnd: number },
): boolean {
  const live = parseLiveScriptureRef(liveText);
  if (!live) return true; // non-scripture live → this is a real content swap
  const targetBook = target.book.toLowerCase().replace(/\s+/g, " ");
  return live.book !== targetBook
    || live.chapter !== target.chapter
    || live.verseStart !== target.verseStart
    || live.verseEnd !== target.verseEnd;
}

/** Decision inputs for the guard. */
export type BibleAntiReplayInput = {
  /** stable per-reference key (the same key used in the sessionStorage map). */
  key: string;
  /** map from key → last-fired epoch ms (sessionStorage-shaped). */
  firedMap: Record<string, number>;
  /** current wall clock. */
  now: number;
  /** parsed live slide text (may be null / non-scripture). */
  liveText?: string | null;
  /** canonical scripture we're about to fire. */
  target: { book: string; chapter: number; verseStart: number; verseEnd: number };
  /** explicit-intent bypass (preacher restates same ref, or voice command). */
  forceLive?: boolean;
  voiceCommand?: boolean;
  /** override for tests. */
  cooldownMs?: number;
};

export type BibleAntiReplayDecision = {
  suppress: boolean;
  /** for observability / test assertions. */
  reason:
    | "fire:no-prior-entry"
    | "fire:stale-entry"
    | "fire:different-ref-live"
    | "fire:force-live-bypass"
    | "fire:voice-command-bypass"
    | "suppress:within-cooldown";
};

/**
 * Pure decision function — should this Bible auto-fire go through, or has
 * the same reference already fired within the last 3s (same-utterance dup)?
 *
 * Ordering matters:
 *   1. forceLive/voiceCommand — always fires (explicit intent).
 *   2. Different reference currently live — always fires (legit swap-back).
 *   3. No prior entry OR entry older than cooldown — fires.
 *   4. Otherwise — suppress.
 */
export function decideBibleAutoFire(input: BibleAntiReplayInput): BibleAntiReplayDecision {
  const cooldown = input.cooldownMs ?? BIBLE_MICRO_COOLDOWN_MS;
  if (input.forceLive) return { suppress: false, reason: "fire:force-live-bypass" };
  if (input.voiceCommand) return { suppress: false, reason: "fire:voice-command-bypass" };
  if (isDifferentRefLive(input.liveText, input.target)) {
    return { suppress: false, reason: "fire:different-ref-live" };
  }
  const firedAt = input.firedMap[input.key];
  if (typeof firedAt !== "number") return { suppress: false, reason: "fire:no-prior-entry" };
  if (input.now - firedAt >= cooldown) return { suppress: false, reason: "fire:stale-entry" };
  return { suppress: true, reason: "suppress:within-cooldown" };
}
