import { BrowserWindow, Display, screen } from "electron";

export type OutputRole = "Projector" | "Stage" | "Livestream";
export type Preset = "720p" | "1080p30" | "1080p60" | "4K";

const ROLE_TO_PATH: Record<OutputRole, string> = {
  Projector: "/live",
  Stage: "/stage",
  Livestream: "/livestream",
};

const outputWindows = new Map<OutputRole, BrowserWindow>();

/**
 * Detect whether the assigned display is the same physical screen the
 * operator is using. If so we MUST NOT go fullscreen — we'd cover the
 * operator UI and the user couldn't get back. Instead open a normal,
 * draggable window that can be pushed onto a second display later.
 */
function isSameAsOperatorDisplay(target: Display): boolean {
  const displays = screen.getAllDisplays();
  if (displays.length === 1) return true;
  const primary = screen.getPrimaryDisplay();
  return target.id === primary.id;
}

export function createOutputWindow(
  role: OutputRole,
  display: Display,
  preset: Preset,
  appUrl: string
): BrowserWindow {
  // Close existing for role
  closeOutputWindow(role);

  const singleDisplay = isSameAsOperatorDisplay(display);
  const { x, y, width, height } = display.bounds;

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
    fullscreenable: !singleDisplay ? true : true,
    resizable: true,
    minimizable: true,
    maximizable: true,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    title: singleDisplay ? `PresentFlow — ${role} Output (drag to external display)` : role,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  try { win.setMenuBarVisibility(false); } catch { /* noop */ }

  const url = `${appUrl}${ROLE_TO_PATH[role]}?preset=${encodeURIComponent(preset)}&role=${encodeURIComponent(role)}${singleDisplay ? "&windowed=1" : ""}`;
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
