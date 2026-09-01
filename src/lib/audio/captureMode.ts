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

export const CAPTURE_MODE_KEY = "presentflow.pro.audioCaptureMode.v1";
export const CAPTURE_MODE_CHANGED_EVENT = "presentflow:capture-mode-changed";

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
export async function resolveEffectiveMode(preferred: CaptureMode): Promise<"native" | "browser"> {
  if (preferred === "browser") return "browser";
  if (preferred === "native") return "native";
  // preferred === "auto":
  // Windows defaults to the proven browser/WASAPI path — its native dshow
  // backend is unverified (see isWindowsRenderer). macOS keeps native
  // auto-selection. These are fully separate branches: the Windows path never
  // engages the native surface, the Mac path never changes.
  if (isWindowsRenderer()) return "browser";
  const available = await isNativeAvailable();
  return available ? "native" : "browser";
}
