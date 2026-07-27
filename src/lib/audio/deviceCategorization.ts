/**
 * deviceCategorization
 * -------------------------------------------------------------------------
 * Central source of truth for classifying MediaDeviceInfo audio inputs into
 * PresentFlow's canonical device categories: NDI, professional mixer /
 * audio interface, Bluetooth headset, generic microphone, or "other".
 *
 * These regexes were previously duplicated across:
 *   - src/components/operator/pro/right/tabs/AudioTab.tsx
 *   - src/components/operator/settings/tabs/AudioTab.tsx
 *   - src/components/operator/AudioDiagnosticsScan.tsx
 *
 * The MIXER regex is battle-tested against real hardware in the field and
 * MUST NOT be reordered or trimmed without an intentional QA pass.
 *
 * Also exports `getDeviceCapabilities`, a lightweight probe that opens a
 * throwaway MediaStream to determine how many channels a device exposes
 * before the operator commits to it in the multi-channel picker.
 *
 * No React. Browser-only (relies on navigator.mediaDevices).
 */

export type DeviceCategory =
  | "ndi"
  | "mixer"
  | "bluetooth"
  | "microphone"
  | "other";

// --- Regexes ---------------------------------------------------------------

const NDI_RE = /ndi/i;

const MIXER_RE =
  /focusrite|scarlett|clarett|behringer|umc|u-phoria|presonus|audiobox|studio ?[12]?[46]|motu|apollo|volt|universal audio|audient|evo|steinberg|ur[0-9]|mackie|onyx|roland|rubix|rme|fireface|babyface|apogee|duet|ensemble|symphony|ssl|solid state|arturia|minifuse|tascam|zoom livetrak|zoom h[0-9]|x32|xr18|xr16|xr12|x-air|yamaha tf|mg[0-9]|allen.*heath|sq-|dlive|qu-|midas|m32|mr18|soundcraft|ui[0-9]|signature|studiolive|touchmix|qsc|dl[0-9]+s|profx|usb audio codec|usb audio device|blackhole/i;

const BT_RE =
  /bluetooth|airpods|beats|jabra|bose|sony wh|sennheiser momentum|galaxy buds|wh-1000/i;

const MIC_RE = /microphone|mic\b|headset|input/i;

// --- Category checks -------------------------------------------------------

export function isNdiDevice(label: string): boolean {
  return NDI_RE.test(label ?? "");
}

export function isMixerDevice(label: string): boolean {
  return MIXER_RE.test(label ?? "");
}

export function isBluetoothDevice(label: string): boolean {
  return BT_RE.test(label ?? "");
}

/**
 * Classify a device label into a single category. Precedence:
 *   ndi > mixer > bluetooth > microphone > other
 * NDI wins over everything (it's a virtual driver we always want first),
 * mixer wins over bluetooth (a mixer over BT should still be treated as a
 * mixer for latency-priority display), bluetooth is demoted last in
 * `categoryRank` because BT audio latency makes it a poor live-mix pick.
 */
export function categorizeDevice(label: string): DeviceCategory {
  const l = label ?? "";
  if (isNdiDevice(l)) return "ndi";
  if (isMixerDevice(l)) return "mixer";
  if (isBluetoothDevice(l)) return "bluetooth";
  if (MIC_RE.test(l)) return "microphone";
  return "other";
}

/**
 * Sort rank for grouping devices in a picker UI. Lower = higher priority.
 *   ndi = 0
 *   mixer = 1
 *   other / microphone = 2
 *   bluetooth = 3   (latency penalty — always last)
 */
export function categoryRank(cat: DeviceCategory): number {
  switch (cat) {
    case "ndi":
      return 0;
    case "mixer":
      return 1;
    case "microphone":
    case "other":
      return 2;
    case "bluetooth":
      return 3;
  }
}

// --- Device capability probe ----------------------------------------------

export interface DeviceCapabilities {
  channelCount: number;
  sampleRate?: number;
}

/**
 * Probe a device by opening a short-lived MediaStream and reading the
 * track settings. Requests up to 32 channels; the browser will negotiate
 * down to whatever the device actually supports.
 *
 * Returns null on any failure (permission denied, device gone, etc.) so
 * the caller can gracefully fall back to a mono assumption.
 *
 * IMPORTANT: this opens and immediately closes a stream. It should be
 * called sparingly (e.g. once when the picker opens), not on every render.
 */
export async function getDeviceCapabilities(
  deviceId: string
): Promise<DeviceCapabilities | null> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return null;
  }
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: deviceId },
        channelCount: { ideal: 32 },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    const track = stream.getAudioTracks()[0];
    if (!track) return null;
    const settings = track.getSettings();
    const channelCount =
      typeof settings.channelCount === "number" && settings.channelCount > 0
        ? settings.channelCount
        : 1;
    const sampleRate =
      typeof settings.sampleRate === "number" && settings.sampleRate > 0
        ? settings.sampleRate
        : undefined;
    return { channelCount, sampleRate };
  } catch {
    return null;
  } finally {
    if (stream) {
      for (const t of stream.getTracks()) {
        try {
          t.stop();
        } catch {
          // noop
        }
      }
    }
  }
}
