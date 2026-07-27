/**
 * Native-mode audio device selection + per-channel routing preferences.
 *
 * Deliberately kept SEPARATE from the browser-mode picker (`presentflow.pro.audioInput.v1`)
 * so switching Capture Mode doesn't clobber the operator's browser-mode
 * pick (or vice-versa). The two modes have distinct device identifiers
 * anyway: browser mode stores Web Audio deviceIds (opaque, per-session),
 * native mode stores ffmpeg's avfoundation/dshow numeric index.
 *
 * Emits `presentflow:native-audio-input-changed` on write so the audio
 * hook can rebuild the pipeline (mirrors the browser-mode
 * `presentflow:audio-input-changed` restart signal).
 */

export const NATIVE_AUDIO_INPUT_KEY = "presentflow.pro.audioInputNative.v1";
export const NATIVE_AUDIO_INPUT_CHANGED_EVENT = "presentflow:native-audio-input-changed";

export type NativeDeviceMode = "mono" | "stereo" | "sum-all";

/**
 * Stored device pick for native capture. `deviceChannel` is a legacy
 * shorthand for a single-channel mono pick; `selectedChannels` + `mode`
 * is the general form (matches the browser-mode DeviceChannelPref shape
 * for consistency in the pipeline builder).
 */
export type NativeDevicePref = {
  index: number;
  name: string;
  channelFilter?: string;          // pre-baked ffmpeg -af filter, optional
  deviceChannel?: number;          // legacy single-channel shorthand
  mode?: NativeDeviceMode;
  selectedChannels?: number[];
  gainDb?: number;
  /** Set (epoch ms) when this pref was written by the launch auto-pick
   *  rather than a manual operator click. Cleared implicitly when the
   *  operator picks a device by hand (that write omits the field). */
  autoPickedAt?: number;
  /** Written by the audio guardian (Agent B) when capture from this
   *  device last produced healthy signal — used for failover ranking. */
  lastWorkingAt?: number;
  /** "Follow Mac system input" mode (2026-07-27). When true, `index` and
   *  `name` are a LAST-RESOLVED CACHE, not the source of truth — the
   *  capture path re-resolves the macOS system-default input by name at
   *  every start (see src/lib/audio/systemDefaultInput.ts) and refreshes
   *  the cache with a direct localStorage write (no event, to avoid a
   *  restart loop). */
  followSystemDefault?: boolean;
};

function isBrowserEnv(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function isValidPref(v: unknown): v is NativeDevicePref {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.index !== "number" || !Number.isFinite(o.index)) return false;
  if (typeof o.name !== "string") return false;
  // Sanitize followSystemDefault: anything non-boolean is coerced away so
  // downstream truthiness checks can't be tricked by injected values.
  if ("followSystemDefault" in o && typeof o.followSystemDefault !== "boolean") {
    delete o.followSystemDefault;
  }
  return true;
}

export function readNativeDevicePref(): NativeDevicePref | null {
  if (!isBrowserEnv()) return null;
  try {
    const raw = localStorage.getItem(NATIVE_AUDIO_INPUT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValidPref(parsed) ? parsed : null;
  } catch { return null; }
}

export function writeNativeDevicePref(pref: NativeDevicePref): void {
  if (!isBrowserEnv()) return;
  try {
    localStorage.setItem(NATIVE_AUDIO_INPUT_KEY, JSON.stringify(pref));
  } catch { /* ignore */ }
  try {
    window.dispatchEvent(new CustomEvent(NATIVE_AUDIO_INPUT_CHANGED_EVENT, { detail: pref }));
  } catch { /* ignore */ }
}

export function clearNativeDevicePref(): void {
  if (!isBrowserEnv()) return;
  try { localStorage.removeItem(NATIVE_AUDIO_INPUT_KEY); } catch { /* ignore */ }
  try {
    window.dispatchEvent(new CustomEvent(NATIVE_AUDIO_INPUT_CHANGED_EVENT, { detail: null }));
  } catch { /* ignore */ }
}

/**
 * Compose an ffmpeg `-af` channel-filter string from a native pref's
 * mode + selectedChannels. Returns undefined for the "sum-all" case
 * (ffmpeg's `-ac 1` handles downmix natively).
 *
 * ffmpeg channel indices are 0-based (c0, c1, c2, …) — the pref stores
 * them the same way.
 *
 * Examples:
 *   { mode: "mono",   selectedChannels: [6] }        → "pan=mono|c0=c6"
 *   { mode: "stereo", selectedChannels: [0, 1] }     → "pan=mono|c0=0.5*c0+0.5*c1"
 *   { mode: "sum-all" }                              → undefined
 */
export function buildChannelFilter(pref: NativeDevicePref | null): string | undefined {
  if (!pref) return undefined;
  const mode = pref.mode ?? "sum-all";
  if (mode === "sum-all") return undefined;
  const chs = pref.selectedChannels ?? [];
  if (!chs.length) return undefined;
  if (mode === "mono") {
    const c = chs[0];
    if (typeof c !== "number") return undefined;
    return `pan=mono|c0=c${c}`;
  }
  // stereo → downmix a chosen pair to mono for Deepgram
  if (mode === "stereo") {
    if (chs.length < 2) return undefined;
    const [a, b] = chs;
    if (typeof a !== "number" || typeof b !== "number") return undefined;
    return `pan=mono|c0=0.5*c${a}+0.5*c${b}`;
  }
  return undefined;
}
