import { BrowserWindow, Display, app, screen } from "electron";
import * as path from "node:path";

// A congregation-safe BLACK page shown when an output window can't load / has
// crashed / is reloading, instead of a Chromium error page or a stuck-hidden
// window. Bundled + loaded via loadFile so it paints with zero network.
// OutputWindow.js compiles to dist-electron/windows/, so two ".." reach the
// repo root's electron/ dir (mirrors main.ts's splash.html resolution).
const OUTPUT_FALLBACK_PATH = path.join(__dirname, "..", "..", "electron", "output-fallback.html");

// Retry backoff for reloading the real output URL after a failure/crash.
// Caps at 8s and repeats indefinitely — a projector must keep trying to
// recover for the whole service, not give up.
const OUTPUT_RETRY_BACKOFF_MS = [1000, 2000, 4000, 8000];

export type OutputRole = "Projector" | "Stage" | "Livestream";
export type Preset = "720p" | "1080p30" | "1080p60" | "4K";

const ROLE_TO_PATH: Record<OutputRole, string> = {
  Projector: "/live",
  Stage: "/stage",
  Livestream: "/livestream",
};

const outputWindows = new Map<OutputRole, BrowserWindow>();

/**
 * R1: "Single-display fallback" is ONLY based on physically having one display.
 * If the operator has 2+ displays and picks primary as the projector, that is
 * an explicit choice — respect it and go fullscreen on primary (even though it
 * covers the operator UI). Previously we silently opened a small windowed
 * fallback whenever target.id === primary.id, which surprised users on
 * multi-display setups.
 */
function isSingleDisplayFallback(): boolean {
  return screen.getAllDisplays().length === 1;
}

export type LivestreamObsMode = "full" | "lowerthird";

export function createOutputWindow(
  role: OutputRole,
  display: Display,
  preset: Preset,
  appUrl: string,
  opts?: { obsMode?: LivestreamObsMode }
): BrowserWindow {
  // Close existing for role
  closeOutputWindow(role);

  const singleDisplay = isSingleDisplayFallback();
  const { x, y, width, height } = display.bounds;

  // P5: livestream window is transparent so OBS/vMix browser sources can key
  // the underlying black/transparent area — projector/stage remain opaque.
  const isLivestream = role === "Livestream";
  // Y1: Linux transparent BrowserWindow is unreliable across compositors
  // (X11/Wayland/GNOME/KDE all differ). Fall back to opaque #00000000 on
  // Linux and let OBS chroma-key the black rectangle instead. Documented
  // in DECISIONS.md.
  const linuxTransparencyFallback = isLivestream && process.platform === "linux";
  const useTransparent = isLivestream && !linuxTransparencyFallback;

  const win = new BrowserWindow({
    // In single-display fallback, open a smallish draggable window at a
    // reasonable spot on the primary screen so the operator can grab it
    // and drag to an external display when connected. Otherwise, fill the
    // target display exactly and go fullscreen.
    x: singleDisplay ? x + Math.max(0, Math.floor((width - 960) / 2)) : x,
    y: singleDisplay ? y + Math.max(0, Math.floor((height - 540) / 2)) : y,
    width: singleDisplay ? 960 : width,
    height: singleDisplay ? 540 : height,
    frame: singleDisplay ? true : false,           // draggable title bar in fallback
    fullscreen: false,                              // toggled after show for real displays
    // Y1: only allow the OS fullscreen toggle when we're actually on a
    // separate display — no point letting the fallback window steal the
    // operator's screen.
    fullscreenable: !singleDisplay,
    resizable: true,
    minimizable: true,
    maximizable: true,
    backgroundColor: isLivestream ? "#00000000" : "#000000",
    transparent: useTransparent,
    hasShadow: !isLivestream,
    autoHideMenuBar: true,
    // Y8: output windows never need keyboard focus — the operator window
    // owns hotkeys. `focusable:false` prevents accidental focus-steal on
    // window spawn and keeps typing in the operator UI. NOTE:
    // `setIgnoreMouseEvents` is deliberately NOT set — the fullscreen
    // coverage on a secondary display is the intended behaviour; the
    // operator window is on the primary display and receives all input.
    focusable: false,
    title: singleDisplay ? `PresentFlow — ${role} Output (drag to external display)` : role,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      // Y6: output pages (/live, /stage, /livestream) never call
      // window.electronAPI — verified by grep. Sandbox on for defense in
      // depth; if a future output page ever needs preload IPC, revisit.
      sandbox: true,
    },
  });
  win.webContents.setBackgroundThrottling(false);

  try { win.setMenuBarVisibility(false); } catch { /* noop */ }

  // S1: Navigation guards. A chromeless fullscreen window must never navigate
  // to an off-origin URL (malicious slide payload, devtools navigate, etc.),
  // and must never spawn child windows.
  const appOrigin = (() => {
    try { return new URL(appUrl).origin; } catch { return null; }
  })();
  win.webContents.on("will-navigate", (e, urlStr) => {
    try {
      const target = new URL(urlStr);
      // Fail CLOSED: block if we can't establish the trusted origin (appOrigin
      // null) or the target isn't exactly it. (loadFile/loadURL recovery loads
      // are programmatic and never emit will-navigate, so the black fallback is
      // unaffected by this guard.)
      if (!appOrigin || target.origin !== appOrigin) {
        e.preventDefault();
        console.warn(`[OutputWindow ${role}] blocked navigation to ${target.origin}`);
      }
    } catch {
      e.preventDefault();
    }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // Y2: kill devtools in packaged builds so a curious/hostile viewer can't
  // pop the inspector and pivot from the output surface.
  if (app.isPackaged) {
    win.webContents.on("devtools-opened", () => {
      try { win.webContents.closeDevTools(); } catch { /* noop */ }
    });
  }

  const livestreamObsParam =
    isLivestream && opts?.obsMode === "lowerthird" ? "&obs=lowerthird" : "";
  // Livestream in lower-third OBS mode also wants a transparent DOM bg so
  // the transparent BrowserWindow shows through — the /livestream page
  // reads `bg=transparent` for that.
  const livestreamBgParam = isLivestream ? "&bg=transparent" : "";
  const url = `${appUrl}${ROLE_TO_PATH[role]}?preset=${encodeURIComponent(preset)}&role=${encodeURIComponent(role)}${singleDisplay ? "&windowed=1" : ""}${livestreamObsParam}${livestreamBgParam}`;

  // ---- Self-recovery: a projector must NEVER show a blank/error/crashed page
  // to a congregation. On any load failure or renderer crash we show the
  // bundled BLACK fallback and keep retrying the real URL on backoff so it
  // self-heals when the network returns. On a successful (re)load, the operator
  // console re-pushes full output state over BroadcastChannel, so the current
  // slide re-syncs automatically.
  let retryTimer: NodeJS.Timeout | null = null;
  // PER-LOAD hung watchdog. A stalled load (TCP connects but the server never
  // responds — captive portals / half-open flaky wifi) fires NEITHER
  // did-finish-load NOR did-fail-load, so without a fresh watchdog per attempt
  // the projector could sit black forever with no retry. Re-armed on every
  // loadReal(), cleared on finish/fail.
  let loadWatchdog: NodeJS.Timeout | null = null;
  let retryIdx = 0;
  let shown = false;
  let disposed = false;

  const clearLoadWatchdog = () => {
    if (loadWatchdog) { clearTimeout(loadWatchdog); loadWatchdog = null; }
  };

  const showWindow = () => {
    if (shown || disposed || win.isDestroyed()) return;
    shown = true;
    try { win.show(); } catch { /* noop */ }
    if (!singleDisplay) {
      try { win.setFullScreen(true); } catch { /* noop */ }
    }
  };

  const showFallback = () => {
    if (disposed || win.isDestroyed()) return;
    // loadFile respawns a renderer even after render-process-gone; black is
    // shown while we keep retrying the real URL underneath.
    win.loadFile(OUTPUT_FALLBACK_PATH).catch((e) =>
      console.error(`[OutputWindow ${role}] fallback load failed`, e)
    );
    showWindow(); // black beats a stuck-hidden window
  };

  const loadReal = () => {
    if (disposed || win.isDestroyed()) return;
    // Arm a fresh 15s stall watchdog for THIS attempt (a stalled load emits
    // neither finish nor fail). On stall: fall back to black + schedule retry.
    clearLoadWatchdog();
    loadWatchdog = setTimeout(() => {
      loadWatchdog = null;
      if (disposed || win.isDestroyed()) return;
      console.warn(`[OutputWindow ${role}] load stalled >15s — falling back + retrying`);
      showFallback();
      scheduleRetry();
    }, 15000);
    // did-fail-load drives the fallback + retry on failure, so just log here.
    win.loadURL(url).catch((e) => console.error(`[OutputWindow ${role}] loadURL`, e));
  };

  const scheduleRetry = () => {
    if (disposed || win.isDestroyed() || retryTimer) return; // one pending retry
    const delay = OUTPUT_RETRY_BACKOFF_MS[Math.min(retryIdx, OUTPUT_RETRY_BACKOFF_MS.length - 1)];
    retryIdx += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      loadReal();
    }, delay);
  };

  win.webContents.on("did-finish-load", () => {
    // Only the REAL output page (strict app origin) counts as recovered — the
    // black fallback is a file:// load and must not reset the backoff.
    let cur = "";
    try { cur = win.webContents.getURL(); } catch { /* noop */ }
    const isAppOrigin = (() => {
      try { return !!appOrigin && new URL(cur).origin === appOrigin; } catch { return false; }
    })();
    if (isAppOrigin) {
      retryIdx = 0;
      clearLoadWatchdog();
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      showWindow();
    }
  });

  win.webContents.on("did-fail-load", (_e, errorCode, errorDescription, _validatedURL, isMainFrame) => {
    if (!isMainFrame) return;          // sub-resource failure — ignore
    if (errorCode === -3) return;      // ERR_ABORTED (superseded nav) — not a real failure
    clearLoadWatchdog();
    console.warn(`[OutputWindow ${role}] did-fail-load ${errorCode} ${errorDescription} — falling back + retrying`);
    showFallback();
    scheduleRetry();
  });

  win.webContents.on("render-process-gone", (_e, details) => {
    console.warn(`[OutputWindow ${role}] render-process-gone: ${details.reason} — recovering`);
    clearLoadWatchdog();
    showFallback();
    scheduleRetry();
  });

  win.on("unresponsive", () => {
    console.warn(`[OutputWindow ${role}] unresponsive — reloading`);
    scheduleRetry();
  });

  loadReal();
  win.once("ready-to-show", showWindow);
  win.on("closed", () => {
    disposed = true;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    clearLoadWatchdog();
    if (outputWindows.get(role) === win) outputWindows.delete(role);
  });

  outputWindows.set(role, win);
  return win;
}

export function closeOutputWindow(role: OutputRole) {
  const existing = outputWindows.get(role);
  if (existing && !existing.isDestroyed()) {
    try { existing.close(); } catch { /* noop */ }
  }
  outputWindows.delete(role);
}

export function closeAll() {
  for (const role of Array.from(outputWindows.keys())) closeOutputWindow(role);
}

export function getOutputWindow(role: OutputRole) {
  return outputWindows.get(role) ?? null;
}
