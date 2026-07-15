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
