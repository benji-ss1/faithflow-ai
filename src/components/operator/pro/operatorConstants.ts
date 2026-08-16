/**
 * ProOperatorShell policy constants — single source of truth.
 *
 * IMPORTANT: Several of these are SIGNED-OFF values locked by CLAUDE.md rule 7.
 * Do not change SONG_AUTOLIVE_CONFIDENCE, SONG_STAGE_CONFIDENCE, or
 * SONG_AUTO_LIVE_MIN_GAP_MS without a fresh field-test session and explicit
 * user sign-off. Each entry notes its sign-off date.
 *
 * Extracted from ProOperatorShell.tsx to:
 *   (a) make constants findable by search without reading 2,930 lines
 *   (b) allow other components (e.g. AIDetections panel) to reference the
 *       same thresholds without duplicating magic numbers
 *   (c) reduce the risk of accidental edit during unrelated refactors
 */

// ── localStorage keys ──────────────────────────────────────────────────────
// Keys are versioned (`.v1`) so a rename can migrate old values safely.
// All keys are prefixed "presentflow." — matches the schema in localStorage-schema.ts.

/** Media strip open/closed state */
export const MEDIA_STRIP_KEY = "presentflow.pro.mediaStripOpen";

/** Slide thumbnail size ("sm" | "md" | "lg") */
export const SLIDE_SIZE_KEY = "presentflow.pro.slideSize";

/** Safe-mode toggle (double-click to go live vs single-click) */
export const SAFE_MODE_KEY = "presentflow.operator.safeMode";

/** Resizable left panel width (px), persisted per machine */
export const LEFT_PANEL_WIDTH_KEY = "presentflow.pro.leftPanelWidth.v1";

/** Song auto-fire session dedup map (5-minute replay suppression) */
export const SONG_AUTO_FIRED_SESSION_KEY = "presentflow.pro.songAutoFired.v1";

/** Bible auto-approve session dedup map */
export const AUTO_FIRED_SESSION_KEY = "presentflow.pro.autoFired.v1";

/** Auto-approve mode ("auto" | "manual") */
export const AUTO_APPROVE_KEY_INSTANT = "presentflow.pro.autoApprove.v1";

/** Auto-advance interval (seconds) */
export const AUTO_ADVANCE_KEY = "presentflow.pro.autoAdvanceSec.v1";

/** Min-gap between Bible auto-fires (ms) */
export const AUTO_FIRE_MIN_GAP_KEY = "presentflow.pro.autoFireMinGap.v1";

/** Hold auto-approve while a song is live */
export const HOLD_DURING_SONG_KEY = "presentflow.pro.holdAutoApproveDuringSong.v1";

/** B3 manual projector text-size multiplier (1.0 = AUTO). A−/A+ nudge it. */
export const FONT_SCALE_KEY = "presentflow.pro.fontScale.v1";
export const FONT_SCALE_MIN = 0.6;
export const FONT_SCALE_MAX = 1.6;
export const FONT_SCALE_STEP = 0.1;
/** Read the persisted font-scale (clamped), defaulting to 1.0 (AUTO). */
export function readFontScale(): number {
  try {
    const raw = localStorage.getItem(FONT_SCALE_KEY);
    const n = raw == null ? 1 : parseFloat(raw);
    if (!Number.isFinite(n)) return 1;
    return Math.max(FONT_SCALE_MIN, Math.min(FONT_SCALE_MAX, n));
  } catch { return 1; }
}

// ── Song detection policy (CLAUDE.md rule 7 — signed-off values) ──────────
// DO NOT lower these without a fresh field-test + user sign-off.

/** Keyboard key that confirms a staged song → goes live. "G" = "Go live".
 *  Space is taken by next-slide navigation so we use G to avoid collision.
 */
export const SONG_AUTOSTAGE_CONFIRM_KEY = "KeyG";

/** Minimum confidence for a song to appear at all (as a manual chip you push
 *  in the AI chip area / "golden section" to go live). Below this it's ignored.
 *  Raised 60 → 70 on 2026-08-14 (user sign-off): songs were over-suggesting —
 *  too many low-confidence chips constantly popping up during worship. The
 *  70-84 band is now suggest-ONLY (operator clicks the chip / presses G to go
 *  live); nothing below 70 surfaces. See CLAUDE.md rule 7.
 */
// 2026-08-16 RAISED 70 → 80 (user sign-off, mid-JPD-service): during the sermon
// the preacher's SPEECH was being matched to songs and surfaced/auto-projected.
// Lifting the suggestion floor to 80 keeps ordinary speech from ever becoming a
// song chip. Nothing below 80 surfaces at all now.
export const SONG_STAGE_CONFIDENCE = 80;

/** Minimum confidence for zero-click auto-live.
 *  Raised 70 → 85 on 2026-08-14 (user sign-off) to match the "high bar before
 *  it projects itself" policy: songs auto-project ONLY at ≥85%; the 70-84 band
 *  is manual (chip / G key). Rationale: songs share lyrics with each other and
 *  with sung worship, so the auto bar must be higher than Bible's 75% to avoid
 *  projecting the wrong song. Paired with SONG_DISAMBIG_MARGIN below. See
 *  CLAUDE.md rule 7.
 */
// 2026-08-16 RAISED 85 → 90 (user sign-off, mid-JPD-service): songs were
// auto-projecting off the preacher's speech during the sermon. Auto-live now
// requires ≥90% (near-certain), so only a clearly-sung, clearly-matched song
// projects itself; the 80-89 band is manual (chip / G key).
export const SONG_AUTOLIVE_CONFIDENCE = 90;

/** Similar-song disambiguation margin (confidence points). Even at ≥85%, a song
 *  only auto-projects if it leads the next-best DIFFERENT song by at least this
 *  much. When two songs match the sung/spoken lyrics almost equally (shared
 *  lines, e.g. two arrangements of the same phrase), the detection can't be sure
 *  WHICH song it is, so it downgrades to a manual chip rather than risk
 *  projecting the wrong one. Added 2026-08-14. See CLAUDE.md rule 7. */
export const SONG_DISAMBIG_MARGIN = 12;

/** Min gap (ms) between same-song auto-live fires.
 *  Nudged from 700 → 800 on 2026-07-24 after a false-trigger report.
 *  Heuristic: if false triggers increase, +100ms until stable.
 */
export const SONG_AUTO_LIVE_MIN_GAP_MS = 800;

// ── Left panel dimensions ──────────────────────────────────────────────────

/** Minimum left panel width in px. */
export const LEFT_PANEL_MIN_WIDTH = 250;

/** Default left panel width on first launch. */
export const LEFT_PANEL_DEFAULT_WIDTH = LEFT_PANEL_MIN_WIDTH;

// ── Bible auto-fire timing ─────────────────────────────────────────────────

/** Default min-gap (ms) between Bible auto-fires (mirrors SONG_AUTO_LIVE_MIN_GAP_MS) */
export const DEFAULT_MIN_GAP_MS = 800;

// ── Auto-advance timing (2026-07-31 field-test tuning — user sign-off) ────
// Target: ≤ 1.6s gap between verse/slide shown and next advance once the
// preacher has moved on. These replace the previous hardcoded 3000ms floors.

/**
 * Minimum time (ms) a song slide must be live before the word-match path
 * can advance. Dynamic: short slides (<5 content words) use SONG_SHORT_SLIDE_FLOOR_MS.
 */
export const SONG_SLIDE_FLOOR_MS = 1200;

/** Floor for short song slides (< 5 non-stopword words) — extra guard. */
export const SONG_SHORT_SLIDE_FLOOR_MS = 2000;

/**
 * Silence duration (ms) after which the silence+coverage path fires if
 * enough of the current slide's words have been spoken.
 * 1800ms > any natural reading pause; well below typical explanation pause (5s+).
 */
export const SONG_SILENCE_ADVANCE_MS = 1800;

/** Coverage fraction (0–1) of current slide words needed to silence-advance. */
export const SONG_COVERAGE_THRESHOLD = 0.65;

/**
 * Minimum time (ms) a Bible verse card must be live before any advance path
 * can fire. Lower than song because verses are read verbatim and preacher
 * cadence is more predictable; 1.6s target is achievable with 1s floor.
 */
export const BIBLE_SLIDE_FLOOR_MS = 1000;

/**
 * Silence duration (ms) for the Bible silence+coverage advance.
 * Longer than song (2500ms) because preachers naturally pause between
 * verses for commentary/explanation.
 */
export const BIBLE_SILENCE_ADVANCE_MS = 2500;

/** Coverage fraction (0–1) of current verse words needed to silence-advance. */
export const BIBLE_COVERAGE_THRESHOLD = 0.60;
