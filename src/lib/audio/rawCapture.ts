/**
 * Raw multichannel capture — opt-in, per device (hardware I/O Phase A,
 * docs/HARDWARE_IO_PLAN.md).
 *
 * Why opt-in: browser DSP (echoCancellation/noiseSuppression/autoGainControl)
 * collapses a USB interface to mono and hides inputs 2+ — but a GLOBAL DSP-off
 * was reverted twice (d357516, a54554f, 2026-08-10) because it under-drove the
 * feed for default-mixer churches. So the default stays DSP-ON (byte-identical
 * constraints to before); an operator flips "Raw multichannel" for a specific
 * interface (X32/XR18, SQ, Focusrite, ATEM Mini USB audio, …).
 *
 * Keyed by deviceId with a label fallback, because Chromium deviceIds can
 * change after a replug.
 */

const KEY = "presentflow.audio.rawCapture.v1";
export const RAW_CAPTURE_CHANGED_EVENT = "presentflow:raw-capture-changed";

interface RawEntry { deviceId: string; label: string }

function readAll(): RawEntry[] {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is RawEntry =>
        !!e && typeof e === "object" &&
        typeof (e as RawEntry).deviceId === "string" &&
        typeof (e as RawEntry).label === "string",
    );
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

export function isRawCaptureEnabled(deviceId: string | null | undefined, label?: string | null): boolean {
  if (!deviceId || deviceId === "default") return false;
  const entries = readAll();
  if (entries.some((e) => e.deviceId === deviceId)) return true;
  const l = label?.trim();
  return !!l && entries.some((e) => e.label === l);
}

export function setRawCaptureEnabled(deviceId: string, label: string, enabled: boolean): void {
  if (!deviceId || deviceId === "default") return;
  const l = label.trim();
  const rest = readAll().filter((e) => e.deviceId !== deviceId && (!l || e.label !== l));
  writeAll(enabled ? [...rest, { deviceId, label: l }] : rest);
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
