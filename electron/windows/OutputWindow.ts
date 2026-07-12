import { BrowserWindow, Display, app, screen } from "electron";

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
    transparent: isLivestream,
    hasShadow: !isLivestream,
    autoHideMenuBar: true,
    title: singleDisplay ? `PresentFlow — ${role} Output (drag to external display)` : role,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

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
      if (appOrigin && target.origin !== appOrigin) {
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
  win.loadURL(url).catch((e) => console.error(`[OutputWindow ${role}]`, e));
  win.once("ready-to-show", () => {
    win.show();
    if (!singleDisplay) {
      try { win.setFullScreen(true); } catch { /* noop */ }
    }
  });
  win.on("closed", () => {
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
