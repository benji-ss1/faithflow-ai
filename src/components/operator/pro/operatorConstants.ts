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

// ── Song detection policy (CLAUDE.md rule 7 — signed-off values) ──────────
// DO NOT lower these without a fresh field-test + user sign-off.

/** Keyboard key that confirms a staged song → goes live. "G" = "Go live".
 *  Space is taken by next-slide navigation so we use G to avoid collision.
 */
export const SONG_AUTOSTAGE_CONFIRM_KEY = "KeyG";

/** Minimum confidence to stage a song for operator confirm (G key).
 *  Below this, the song appears only as a passive chip. Signed off 2026-07-26.
 */
export const SONG_STAGE_CONFIDENCE = 60;

/** Minimum confidence for zero-click auto-live.
 *  Lowered from 85 → 70 on 2026-07-26 with user sign-off after field data
 *  showed most real detections in the 60–84% band were being missed.
 *  Hard floor is 65% — do not lower below it. See CLAUDE.md rule 7.
 */
export const SONG_AUTOLIVE_CONFIDENCE = 70;

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
