/**
 * transcriptDisplayPrefs — session-persisted preferences for the Pro
 * operator's transcript display. Owns two knobs:
 *
 *   - heightPx: the operator-chosen height of the transcript panel
 *     (drag-resize handle at the bottom edge).
 *   - minimized: whether the panel is collapsed to a thin bar.
 *
 * Storage: localStorage under `presentflow.pro.transcriptDisplay.v1`.
 * SSR-safe — every read/write is gated on `typeof window`.
 *
 * Default height math: current LiveTranscriptPanel used
 * `min-h-[150px] max-h-[280px]`, natural default ≈ 200px. Change 3
 * asks for +40% ≈ 280px, so we ship 280px as the new default.
 */

export const TRANSCRIPT_DISPLAY_PREFS_KEY = "presentflow.pro.transcriptDisplay.v1";

export type TranscriptDisplayPrefs = {
  heightPx: number;
  minimized: boolean;
};

// Baseline of 200px (the previous panel's natural default), +40% = 280px.
export const DEFAULT_TRANSCRIPT_HEIGHT_PX = 280;
export const MIN_TRANSCRIPT_HEIGHT_PX = 80;
// Max cap is enforced live at drag-time against the parent panel height
// (60% of parent) — this is a fallback ceiling for any pre-existing
// oversized value in localStorage.
export const HARD_MAX_TRANSCRIPT_HEIGHT_PX = 1200;

export const DEFAULT_TRANSCRIPT_DISPLAY_PREFS: TranscriptDisplayPrefs = {
  heightPx: DEFAULT_TRANSCRIPT_HEIGHT_PX,
  minimized: false,
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Read prefs from localStorage. Returns defaults on SSR or on any
 * parse/shape failure. Never throws.
 */
export function readTranscriptDisplayPrefs(): TranscriptDisplayPrefs {
  if (typeof window === "undefined") return { ...DEFAULT_TRANSCRIPT_DISPLAY_PREFS };
  try {
    const raw = window.localStorage.getItem(TRANSCRIPT_DISPLAY_PREFS_KEY);
    if (!raw) return { ...DEFAULT_TRANSCRIPT_DISPLAY_PREFS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_TRANSCRIPT_DISPLAY_PREFS };
    const heightRaw = typeof parsed.heightPx === "number" && Number.isFinite(parsed.heightPx)
      ? parsed.heightPx
      : DEFAULT_TRANSCRIPT_HEIGHT_PX;
    const minimized = parsed.minimized === true;
    return {
      heightPx: clamp(heightRaw, MIN_TRANSCRIPT_HEIGHT_PX, HARD_MAX_TRANSCRIPT_HEIGHT_PX),
      minimized,
    };
  } catch {
    return { ...DEFAULT_TRANSCRIPT_DISPLAY_PREFS };
  }
}

/**
 * Write prefs to localStorage. No-op on SSR or on write failure
 * (private-mode Safari etc.). Clamps height to the sensible range.
 */
export function writeTranscriptDisplayPrefs(next: TranscriptDisplayPrefs): void {
  if (typeof window === "undefined") return;
  try {
    const safe: TranscriptDisplayPrefs = {
      heightPx: clamp(next.heightPx, MIN_TRANSCRIPT_HEIGHT_PX, HARD_MAX_TRANSCRIPT_HEIGHT_PX),
      minimized: next.minimized === true,
    };
    window.localStorage.setItem(TRANSCRIPT_DISPLAY_PREFS_KEY, JSON.stringify(safe));
  } catch {
    // Ignored — storage full / disabled. Prefs will fall back to defaults
    // next session; not worth surfacing to the operator mid-service.
  }
}
