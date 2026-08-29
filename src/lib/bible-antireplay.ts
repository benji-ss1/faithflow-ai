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
  // Translation code is OPTIONAL (2026-08-29): the projected reference is
  // code-less when the operator's "display translation" toggle is off, so a
  // mandatory (CODE) suffix made this always return null → the already-live
  // suppression guard was silently defeated.
  const m = liveText.match(/(\d?\s*[A-Za-z]+)\s+(\d+):(\d+)(?:-(\d+))?(?:\s*\([A-Za-z0-9]+\))?\s*$/);
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
    | "fire:different-ref-live"
    | "fire:voice-command-bypass"
    | "suppress:already-live";
};

/**
 * Pure decision function — should this Bible auto-fire go through, or has
 * the same reference already fired within the last 3s (same-utterance dup)?
 *
 * Ordering matters:
 *   1. voiceCommand — always fires (explicit operator/preacher navigation).
 *   2. Different reference (or non-scripture) currently live — fires. This is a
 *      real content change / swap-back; no cooldown gate, so a fast bounce
 *      (Matt → Gen → Matt within seconds) projects each hop.
 *   3. Otherwise the EXACT reference is already the live slide — SUPPRESS
 *      (fade-pulse fix, 2026-08-19). Re-projecting an identical, on-screen verse
 *      changes nothing and only replays the transition (the audience-visible
 *      pulse). Same-utterance interim/final/whisper duplicates land here too and
 *      are covered by the same rule — which is why the former firedMap /
 *      micro-cooldown / forceLive gating is gone. Mirrors the song path's
 *      same-song-already-live skip. `firedMap`/`now`/`forceLive`/`cooldownMs`
 *      remain on the input type for the sessionStorage analytics shape but no
 *      longer affect the decision.
 */
export function decideBibleAutoFire(input: BibleAntiReplayInput): BibleAntiReplayDecision {
  // Voice commands are explicit navigation — always project.
  if (input.voiceCommand) return { suppress: false, reason: "fire:voice-command-bypass" };
  // A DIFFERENT reference (or non-scripture) is live → this is a genuine content
  // change / swap-back. Fire IMMEDIATELY — no cooldown gate, so a fast bounce
  // (Matt → Gen → Matt within seconds) still projects each hop.
  if (isDifferentRefLive(input.liveText, input.target)) {
    return { suppress: false, reason: "fire:different-ref-live" };
  }
  // FADE-PULSE FIX (2026-08-19): the EXACT reference is ALREADY the live slide.
  // Re-projecting an identical, unchanged verse changes nothing on screen and
  // only republishes OutputState + replays the transition — the audience-visible
  // "fade pulse" a preacher triggers by holding/re-citing the same verse. Never
  // re-fire it (mirrors the song path's same-song-already-live skip). Same-
  // utterance interim/final/whisper duplicates land here too and are covered by
  // the same rule, which is why the old firedMap / micro-cooldown / forceLive
  // gating (only ever reached in this same-ref-live branch) is no longer needed.
  return { suppress: true, reason: "suppress:already-live" };
}
