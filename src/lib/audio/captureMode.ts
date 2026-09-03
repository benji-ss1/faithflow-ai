/**
 * Capture mode selector — chooses between the browser's getUserMedia
 * pipeline and the native ffmpeg-backed capture exposed by the Electron
 * main process (window.electronAPI.audio.native, Wave 1).
 *
 * Persisted per-machine in localStorage. The renderer resolves the
 * "effective" mode at pipeline start via {@link resolveEffectiveMode},
 * which downgrades "native" to "browser" when the native surface isn't
 * present (web app, non-Electron dev harness, missing preload).
 *
 * A window-level CustomEvent (`presentflow:capture-mode-changed`) fires
 * on every writeCaptureMode() call so the audio hook can rebuild the
 * pipeline without a page reload — mirrors the existing
 * `presentflow:audio-input-changed` restart signal.
 */

export type CaptureMode = "native" | "browser" | "auto";
// The concrete mode the pipeline actually runs. "ndi" receives audio over the
// network from an NDI source (via the Electron main-process receiver) and feeds
// it into the SAME downstream as native/browser PCM.
export type EffectiveCaptureMode = "native" | "browser" | "ndi";

export const CAPTURE_MODE_KEY = "presentflow.pro.audioCaptureMode.v1";
export const CAPTURE_MODE_CHANGED_EVENT = "presentflow:capture-mode-changed";

// The operator's selected NDI audio source (exact NDI name). Empty/absent = NDI
// audio off (use native/browser). Persisted per-machine; a change fires the same
// capture-mode-changed event so the audio hook rebuilds the pipeline.
export const NDI_AUDIO_SOURCE_KEY = "presentflow.audio.ndiSource.v1";

export function readNdiAudioSource(): string | null {
  if (!isBrowserEnv()) return null;
  try {
    const v = localStorage.getItem(NDI_AUDIO_SOURCE_KEY);
    return v && v.trim() ? v : null;
  } catch { return null; }
}
export function writeNdiAudioSource(name: string | null): void {
  if (!isBrowserEnv()) return;
  try {
    if (name && name.trim()) localStorage.setItem(NDI_AUDIO_SOURCE_KEY, name.trim());
    else localStorage.removeItem(NDI_AUDIO_SOURCE_KEY);
  } catch { /* ignore */ }
  // Reuse the capture-mode change signal so the audio hook does a full restart.
  try { window.dispatchEvent(new CustomEvent(CAPTURE_MODE_CHANGED_EVENT, { detail: { ndiSource: name ?? null } })); } catch { /* ignore */ }
}

// Whether the Electron NDI-receive bridge is present (desktop app only).
export function isNdiAudioBridgePresent(): boolean {
  if (!isBrowserEnv()) return false;
  const api = (window as unknown as { electronAPI?: { ndiAudio?: { startReceive?: unknown } } }).electronAPI;
  return typeof api?.ndiAudio?.startReceive === "function";
}

// Type-narrowed view of the electronAPI surface we care about. Kept local
// (not imported from electron.d.ts) so this module compiles cleanly even
// when the global type augmentation isn't loaded — the module is imported
// by pure-web renders too.
type NativeAudioAPI = {
  audio?: {
    native?: {
      isAvailable: () => Promise<boolean>;
    };
  };
};

function isBrowserEnv(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

/**
 * True on a Windows browser / Electron renderer.
 *
 * The native ffmpeg capture path is field-proven on macOS (CoreAudio via the
 * Swift helper) but UNVERIFIED on Windows, where it runs through ffmpeg's
 * DirectShow (dshow) backend. dshow device-name matching is fragile (long
 * parenthesised names, historical 31-char truncation, duplicate-name
 * collisions) and — critically — a silent "success" on the wrong device or a
 * silent channel has NO auto-fallback to the browser path (it would surface
 * only as a mid-service "no audio" toast). Until that path is field-tested on
 * Windows, "auto" must NOT select it. An operator can still opt into native
 * explicitly via the capture-mode toggle; this only changes the default.
 */
function isWindowsRenderer(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = `${navigator.userAgent} ${(navigator as Navigator).platform || ""}`.toLowerCase();
  return /windows|win32|win64|wow64/.test(ua);
}

/**
 * Read the operator's preferred capture mode from localStorage. Defaults
 * to "auto" (native when available, browser otherwise). SSR-safe:
 * returns "browser" during server-side render so any pipeline
 * initialisation on the server never accidentally attempts a native
 * probe against an undefined window.
 */
export function readCaptureMode(): CaptureMode {
  if (!isBrowserEnv()) return "browser";
  try {
    const raw = localStorage.getItem(CAPTURE_MODE_KEY);
    if (raw === "native" || raw === "browser" || raw === "auto") return raw;
  } catch { /* ignore */ }
  return "auto";
}

/**
 * Persist the capture mode + notify listeners. The audio hook binds a
 * window listener for CAPTURE_MODE_CHANGED_EVENT and does a full
 * pipeline restart on receipt (same code path as an audio-input swap).
 */
export function writeCaptureMode(mode: CaptureMode): void {
  if (!isBrowserEnv()) return;
  try { localStorage.setItem(CAPTURE_MODE_KEY, mode); } catch { /* ignore */ }
  try {
    window.dispatchEvent(new CustomEvent(CAPTURE_MODE_CHANGED_EVENT, { detail: { mode } }));
  } catch { /* ignore */ }
}

// Cache the availability probe result — the underlying isAvailable()
// invokes an IPC round-trip that always returns the same value for the
// lifetime of the Electron process (it depends on ffmpeg-binary presence
// and platform). Cached until the tab reloads.
let cachedAvailability: Promise<boolean> | null = null;

/**
 * Whether the native ffmpeg capture bridge is present + operational.
 * Returns false immediately on the web app (no electronAPI surface) and
 * on any error inside the IPC probe. Cached for the tab lifetime.
 */
export function isNativeAvailable(): Promise<boolean> {
  if (cachedAvailability) return cachedAvailability;
  if (!isBrowserEnv()) return Promise.resolve(false);
  const api = (window as unknown as { electronAPI?: NativeAudioAPI }).electronAPI;
  const probe = api?.audio?.native?.isAvailable;
  if (typeof probe !== "function") {
    cachedAvailability = Promise.resolve(false);
    return cachedAvailability;
  }
  cachedAvailability = probe()
    .then((v) => !!v)
    .catch(() => false);
  return cachedAvailability;
}

/**
 * Resolve the effective concrete capture mode ("native" or "browser")
 * from the operator's preferred mode. Implements the "auto" fallback:
 *   preferred === "browser"       → "browser"
 *   preferred === "native"        → "native"  (even if unavailable — caller
 *                                              is expected to bail to browser
 *                                              on the actual start failure)
 *   preferred === "auto"          → "native" if isNativeAvailable(), else "browser"
 *
 * Note: when preferred==="native" we do NOT downgrade here — the operator
 * explicitly asked for native and the pipeline should surface any
 * downstream error rather than silently pretend they picked browser.
 */
export async function resolveEffectiveMode(preferred: CaptureMode): Promise<EffectiveCaptureMode> {
  // NDI audio takes priority whenever the operator has selected a source AND the
  // desktop NDI-receive bridge is present — this is an EXPLICIT choice and works
  // on Windows (unlike the native ffmpeg path). If the NDI receive later fails to
  // start, the caller falls back to the browser path like it does for native.
  if (isNdiAudioBridgePresent() && readNdiAudioSource()) return "ndi";
  if (preferred === "browser") return "browser";
  // WINDOWS: the native ffmpeg/dshow backend is stubbed + unverified — its
  // startCapture returns ok on ffmpeg SPAWN (not device open), so a silent
  // wrong/duplicate-named-device success has NO fallback and surfaces only as a
  // mid-service "no audio" toast. That is unacceptable for a live service. So on
  // Windows we lock native OFF ENTIRELY: even an EXPLICIT 'native' pick resolves
  // to the proven browser/WASAPI path. macOS keeps its field-proven native path.
  if (isWindowsRenderer()) {
    if (preferred === "native") console.warn("[capture] native mode is not available on Windows yet — using the browser/WASAPI path.");
    return "browser";
  }
  if (preferred === "native") return "native";
  const available = await isNativeAvailable();
  return available ? "native" : "browser";
}
