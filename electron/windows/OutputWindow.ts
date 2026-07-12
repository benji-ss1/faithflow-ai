import { BrowserWindow, Display } from "electron";

export type OutputRole = "Projector" | "Stage" | "Livestream";
export type Preset = "720p" | "1080p30" | "1080p60" | "4K";

const ROLE_TO_PATH: Record<OutputRole, string> = {
  Projector: "/live",
  Stage: "/stage",
  Livestream: "/livestream",
};

const outputWindows = new Map<OutputRole, BrowserWindow>();

export function createOutputWindow(
  role: OutputRole,
  display: Display,
  preset: Preset,
  appUrl: string
): BrowserWindow {
  // Close existing for role
  closeOutputWindow(role);

  const { x, y, width, height } = display.bounds;
  const win = new BrowserWindow({
    x, y, width, height,
    frame: false,
    fullscreen: false, // will toggle after show to avoid dock issues
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const url = `${appUrl}${ROLE_TO_PATH[role]}?preset=${encodeURIComponent(preset)}&role=${encodeURIComponent(role)}`;
  win.loadURL(url).catch((e) => console.error(`[OutputWindow ${role}]`, e));
  win.once("ready-to-show", () => {
    win.show();
    try { win.setFullScreen(true); } catch {}
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
    try { existing.close(); } catch {}
  }
  outputWindows.delete(role);
}

export function closeAll() {
  for (const role of Array.from(outputWindows.keys())) closeOutputWindow(role);
}

export function getOutputWindow(role: OutputRole) {
  return outputWindows.get(role) ?? null;
}
