/**
 * Raw multichannel capture ("Separate channels from my mixer") — per device
 * (hardware I/O Phase A, docs/HARDWARE_IO_PLAN.md).
 *
 * 2026-09-17 (user-directed): ON BY DEFAULT for recognised USB mixers /
 * interfaces (and Blackmagic ATEM USB audio), OFF by default for everything
 * else. Browser DSP collapses an interface to mono and hides inputs 2+, but a
 * GLOBAL DSP-off was reverted twice (d357516, a54554f) because it under-drove
 * ordinary microphones — so laptop/USB mics, generic "USB Audio Device"
 * dongles and loopback drivers keep DSP ON unless the operator opts in.
 * The operator can override either way per device; the override persists.
 *
 * Keyed by deviceId with a label fallback, because Chromium deviceIds can
 * change after a replug.
 */

import { isMixerDevice } from "./deviceCategorization";

const KEY = "presentflow.audio.rawCapture.v1";
export const RAW_CAPTURE_CHANGED_EVENT = "presentflow:raw-capture-changed";

interface RawEntry { deviceId: string; label: string; enabled: boolean }

function readAll(): RawEntry[] {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is { deviceId: string; label: string; enabled?: unknown } =>
          !!e && typeof e === "object" &&
          typeof (e as RawEntry).deviceId === "string" &&
          typeof (e as RawEntry).label === "string",
      )
      // Pre-2026-09-17 entries had no `enabled` field and only existed when ON.
      .map((e) => ({ deviceId: e.deviceId, label: e.label, enabled: e.enabled !== false }));
  } catch {
    return [];
  }
}

function writeAll(entries: RawEntry[]): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(entries));
  } catch {
    /* storage blocked — setting just won't persist */
  }
  try {
    globalThis.window?.dispatchEvent(new CustomEvent(RAW_CAPTURE_CHANGED_EVENT));
  } catch {
    /* non-browser */
  }
}

/** Default when the operator hasn't chosen: ON for real mixers/interfaces only. */
export function defaultRawCapture(label: string | null | undefined): boolean {
  const l = label ?? "";
  // Generic dongles / loopback match MIXER_RE but aren't multichannel mixers.
  // (Don't exclude "Microphone (...)": Windows names interfaces that way.)
  if (/usb audio (codec|device)|blackhole/i.test(l)) return false;
  return isMixerDevice(l) || /\batem\b|blackmagic/i.test(l);
}

export function isRawCaptureEnabled(deviceId: string | null | undefined, label?: string | null): boolean {
  if (!deviceId || deviceId === "default") return false;
  const entries = readAll();
  const byId = entries.find((e) => e.deviceId === deviceId);
  if (byId) return byId.enabled;
  const l = label?.trim();
  const byLabel = l ? entries.find((e) => e.label === l) : undefined;
  if (byLabel) return byLabel.enabled;
  return defaultRawCapture(l);
}

export function setRawCaptureEnabled(deviceId: string, label: string, enabled: boolean): void {
  if (!deviceId || deviceId === "default") return;
  const l = label.trim();
  const rest = readAll().filter((e) => e.deviceId !== deviceId && (!l || e.label !== l));
  writeAll([...rest, { deviceId, label: l, enabled }]);
}

/** DSP constraints. `raw=false` returns exactly the pre-Phase-A values. */
export function dspConstraints(raw: boolean): Pick<
  MediaTrackConstraints,
  "echoCancellation" | "noiseSuppression" | "autoGainControl"
> {
  return raw
    ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    : { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
}
