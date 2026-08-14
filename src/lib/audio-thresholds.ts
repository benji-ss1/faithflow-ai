/**
 * Canonical audio + transcript confidence thresholds.
 *
 * Kept in a dedicated module so client, server, autopilot gate, and tests
 * all read the same numbers. Do not inline these values elsewhere; import
 * from here.
 */

/**
 * Minimum Deepgram confidence (0..1) required before any confidence-boost
 * is applied in the scripture blend formula, and required before the
 * autopilot auto-approve gate will fire.
 *
 * Below this floor:
 *   - blendScripture treats dgConf as 1.0 replaced with 0 boost (parser only)
 *   - autopilot must NOT auto-approve — promote to suggestion state instead
 *
 * Word-level: any word inside a detection's matched span with confidence
 * below this value blocks auto-approve.
 */
export const CONFIDENCE_THRESHOLD = 0.45;

/**
 * Minimum BLENDED scripture confidence (0..100, the value shown on the AI chip)
 * required to AUTO-PROJECT a detected Bible verse to live when AUTO mode is on.
 *
 * Policy (JPD field sign-off 2026-08-14): raised 70 → 75 after low-confidence
 * verses were auto-projecting during scripture reading ("70-74% verses we never
 * said popping onto the screen"). This is a HARD floor:
 *   - >= 75  → may auto-project (still subject to AUTO toggle, anti-replay, min-gap)
 *   - 70..74 → SUGGEST ONLY. Shows as a tappable AI chip; NEVER auto-fires.
 *   - < 70   → passive suggestion only.
 * No bypass: `forceLive` (repeated reference) and `voiceCommand` may skip the
 * min-gap cooldown but MUST NOT push a sub-75 verse live. A shaky/whisper-band
 * detection must never project itself — operator taps the chip to confirm.
 */
export const BIBLE_AUTOFIRE_CONFIDENCE = 75;

/**
 * Lower bound of the SUGGEST-ONLY band (0..100). A detected verse whose blended
 * confidence is in [BIBLE_SUGGEST_CONFIDENCE, BIBLE_AUTOFIRE_CONFIDENCE) shows a
 * manual "we think we heard X — put it live?" prompt the operator can accept.
 * Below this, the detection does nothing (no prompt, no auto-fire) — too shaky
 * to even ask about. JPD field sign-off 2026-08-14: suggest band = 65..74.
 */
export const BIBLE_SUGGEST_CONFIDENCE = 65;
