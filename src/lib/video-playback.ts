/**
 * Video trim, end-of-clip behaviour, rate and volume — ProPresenter parity (R4).
 *
 * WHAT WAS MISSING: a slide video had only `loop` on/off and a `muted` boolean.
 * No trim, so an operator had to re-export a file to cut two seconds of slate
 * off the front. No end-of-clip choice, so a non-looping clip's behaviour was
 * whatever the browser happened to do. No rate. No volume level — only "muted
 * or full blast", which is a real problem when a clip's audio is hotter than
 * the room's music.
 *
 * ProPresenter gives all of these per media cue. They are ordinary needs, not
 * power-user extras: "start after the countdown", "hold on the last frame",
 * "quieter than the band".
 *
 * Pure arithmetic — no DOM — so every edge case below is unit-tested. The
 * element wiring lives in the renderer.
 *
 * EVERY DEFAULT PRESERVES TODAY'S BEHAVIOUR. Absent trim = whole clip. Absent
 * endAction = derived from the existing `loop` flag. Absent rate = 1. Absent
 * volume = the existing `muted` boolean. An existing slide renders identically.
 */

/** What happens when the clip reaches its out-point. */
export type VideoEndAction =
  /** Start again. What `loop: true` has always meant. */
  | "loop"
  /** Hold the last frame on screen. The browser default for a non-looping clip. */
  | "freeze"
  /** Take it off the screen and reveal whatever is behind it. */
  | "clear";

export type VideoPlaybackSpec = {
  loop?: boolean;
  endAction?: VideoEndAction;
  /** Seconds from the start of the file. */
  inSec?: number;
  /** Seconds from the start of the file. Absent = play to the end. */
  outSec?: number;
  /** 0.25–4. 1 = normal. */
  rate?: number;
  /** 0–1. Ignored when `muted` is true. */
  volume?: number;
  muted?: boolean;
};

export const MIN_RATE = 0.25;
export const MAX_RATE = 4;

/**
 * The end behaviour actually in force. `endAction` wins when set; otherwise we
 * derive it from `loop` so every existing slide keeps doing exactly what it did.
 */
export function resolveEndAction(v: VideoPlaybackSpec): VideoEndAction {
  if (v.endAction) return v.endAction;
  return (v.loop ?? true) ? "loop" : "freeze";
}

export type Trim = { start: number; end: number };

/**
 * The in/out points to actually use, given the file's real duration.
 *
 * Defensive on purpose: these numbers come from an editor and travel over a
 * wire, and a bad pair must never produce a video that plays nothing, seeks
 * forever, or sits at NaN. Anything incoherent falls back to the whole clip.
 */
export function resolveTrim(v: VideoPlaybackSpec, duration: number): Trim {
  const whole = { start: 0, end: Number.isFinite(duration) && duration > 0 ? duration : 0 };
  if (!Number.isFinite(duration) || duration <= 0) return whole;

  const rawIn = Number.isFinite(v.inSec as number) ? Math.max(0, v.inSec as number) : 0;
  const rawOut = Number.isFinite(v.outSec as number) ? (v.outSec as number) : duration;

  const start = Math.min(rawIn, duration);
  const end = Math.min(Math.max(rawOut, 0), duration);
  // An out-point at or before the in-point would mean "play nothing". Treat it
  // as a mistake and play the whole clip rather than showing a dead frame.
  if (end <= start) return whole;
  return { start, end };
}

/** Playback rate, clamped so a typo cannot stall or fast-forward absurdly. */
export function resolveRate(v: VideoPlaybackSpec): number {
  const r = v.rate;
  if (!Number.isFinite(r as number) || (r as number) <= 0) return 1;
  return Math.max(MIN_RATE, Math.min(MAX_RATE, r as number));
}

/** Effective volume. `muted` still wins, so nothing gets louder than before. */
export function resolveVolume(v: VideoPlaybackSpec): { muted: boolean; volume: number } {
  const muted = v.muted ?? true;
  const raw = v.volume;
  const volume = Number.isFinite(raw as number) ? Math.max(0, Math.min(1, raw as number)) : 1;
  return { muted, volume };
}

/**
 * Has playback passed the out-point? A small tolerance absorbs the fact that
 * `timeupdate` fires every ~250ms and will overshoot.
 */
export function pastOut(currentTime: number, trim: Trim, tolerance = 0.03): boolean {
  if (!Number.isFinite(currentTime)) return false;
  return currentTime >= trim.end - tolerance;
}

/** Did a seek or a loop leave us before the in-point? */
export function beforeIn(currentTime: number, trim: Trim, tolerance = 0.03): boolean {
  if (!Number.isFinite(currentTime)) return false;
  return currentTime < trim.start - tolerance;
}

/** True when this spec needs per-frame supervision at all. A clip with no trim
 *  and a plain loop/freeze is left entirely to the browser, exactly as now. */
export function needsSupervision(v: VideoPlaybackSpec): boolean {
  const trimmed = Number.isFinite(v.inSec as number) || Number.isFinite(v.outSec as number);
  return trimmed || resolveEndAction(v) === "clear";
}
