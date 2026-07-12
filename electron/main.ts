import { app, BrowserWindow, Tray, Menu, nativeImage, session, ipcMain, shell } from "electron";
import * as path from "path";
import { spawn, ChildProcess } from "child_process";
import * as net from "net";
import { registerScreenIpc, closeAllOutputWindows, openOutputForRole } from "./ipc/screens";
import { registerAudioIpc } from "./ipc/audio";
import { registerDialogIpc } from "./ipc/dialog";
import { registerFsIpc } from "./ipc/fs";

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let nextServerProc: ChildProcess | null = null;
let appUrl = "http://localhost:3000";

// First-party hosts allowed to receive the x-pf-shell header. Computed once
// after appUrl is known (see registerFirstPartyHosts). Also used by the
// shell.openExternal handler as part of the allowlist.
const FIRST_PARTY_HOSTS = new Set<string>(["localhost", "127.0.0.1"]);
const EXTERNAL_URL_ALLOWED_HOSTS = new Set<string>([
  "presentflow.app",
  "app.presentflow.com",
  "localhost",
  "127.0.0.1",
]);

function registerFirstPartyHosts() {
  try {
    const u = new URL(appUrl);
    FIRST_PARTY_HOSTS.add(u.host);
    EXTERNAL_URL_ALLOWED_HOSTS.add(u.hostname);
  } catch {}
  const envUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (envUrl) {
    try {
      const u = new URL(envUrl);
      FIRST_PARTY_HOSTS.add(u.host);
      EXTERNAL_URL_ALLOWED_HOSTS.add(u.hostname);
    } catch {}
  }
}

let shellHeaderListenerRegistered = false;

async function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

async function startNextServer(): Promise<string> {
  const port = await pickFreePort();
  // Resolve standalone server.js relative to app resources
  const resourcesPath = process.resourcesPath || path.join(__dirname, "..");
  const candidates = [
    path.join(resourcesPath, ".next", "standalone", "server.js"),
    path.join(__dirname, "..", ".next", "standalone", "server.js"),
    path.join(process.cwd(), ".next", "standalone", "server.js"),
  ];
  const serverJs = candidates.find((p) => {
    try {
      require("fs").accessSync(p);
      return true;
    } catch {
      return false;
    }
  });
  if (!serverJs) {
    throw new Error(
      "Could not locate .next/standalone/server.js. Run `next build` first (output: 'standalone')."
    );
  }
  const cwd = path.dirname(serverJs);
  nextServerProc = spawn(process.execPath, [serverJs], {
    cwd,
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      // Electron sets ELECTRON_RUN_AS_NODE=1 so the child runs as pure Node
      ELECTRON_RUN_AS_NODE: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  nextServerProc.stdout?.on("data", (d) => process.stdout.write(`[next] ${d}`));
  nextServerProc.stderr?.on("data", (d) => process.stderr.write(`[next!] ${d}`));

  // Wait for readiness by polling
  const url = `http://127.0.0.1:${port}`;
  const start = Date.now();
  while (Date.now() - start < 30000) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = require("http").get(url, (res: any) => {
          res.destroy();
          resolve();
        });
        req.on("error", reject);
        req.setTimeout(500, () => {
          req.destroy(new Error("timeout"));
        });
      });
      return url;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error("Next server never became ready");
}

function createTray() {
  try {
    const icon = nativeImage.createEmpty();
    tray = new Tray(icon);
    const menu = Menu.buildFromTemplate([
      { label: "Show / Hide Window", click: toggleMain },
      { label: "Open Screen Config", click: () => openScreenConfig() },
      { type: "separator" },
      { label: "Quit Present Flow", click: () => { app.quit(); } },
    ]);
    tray.setToolTip("Present Flow");
    tray.setContextMenu(menu);
  } catch (err) {
    console.warn("Failed to create tray:", err);
  }
}

function toggleMain() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) mainWindow.hide();
  else mainWindow.show();
}

function openScreenConfig() {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.webContents.loadURL(`${appUrl}/settings/screens`).catch(() => {});
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => { mainWindow = null; });

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow.webContents.on(
    "did-fail-load",
    (_e, code, desc, url) => {
      console.error(`[main] did-fail-load ${code} ${desc} → ${url}`);
    }
  );
  mainWindow.webContents.on(
    "console-message",
    (_e, level, message, line, sourceId) => {
      console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
    }
  );

  const initialUrl = appUrl + (appUrl.includes("?") ? "&" : "?") + "ff_shell=desktop";
  await mainWindow.loadURL(initialUrl);
}

app.whenReady().then(async () => {
  // Pre-approve media permissions so navigator.mediaDevices works without prompts
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    if (permission === "media" || (permission as string) === "audioCapture") cb(true);
    else cb(true);
  });

  if (isDev) {
    const devPort = process.env.PRESENTFLOW_DEV_PORT || "3000";
    appUrl = `http://localhost:${devPort}`;
  } else {
    try {
      appUrl = await startNextServer();
    } catch (err) {
      console.error("Failed to start Next server:", err);
      app.quit();
      return;
    }
  }

  registerFirstPartyHosts();

  // Inject a shell marker on every request from the desktop app, but only for
  // first-party hosts (our Next server + configured NEXT_PUBLIC_APP_URL). We
  // must not leak this header to third-party analytics/CDNs. Guarded so
  // hot-reload can't stack duplicate handlers.
  if (!shellHeaderListenerRegistered) {
    session.defaultSession.webRequest.onBeforeSendHeaders((details, cb) => {
      let host = "";
      try { host = new URL(details.url).host; } catch { /* pass through */ }
      if (host && FIRST_PARTY_HOSTS.has(host)) {
        cb({ requestHeaders: { ...details.requestHeaders, "x-pf-shell": "desktop" } });
      } else {
        cb({ requestHeaders: details.requestHeaders });
      }
    });
    shellHeaderListenerRegistered = true;
  }

  // IPC registration
  registerScreenIpc(() => appUrl);
  registerAudioIpc();
  registerDialogIpc();
  registerFsIpc();

  // Utility IPC
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("app:platform", () => process.platform);

  // Open external URLs in the default browser. Used by the desktop sidebar's
  // "Manage your church online" link to route admins to the web portal.
  ipcMain.handle("shell:openExternal", async (_e, url: string) => {
    try {
      if (typeof url !== "string") {
        console.warn("[shell:openExternal] rejected: not a string");
        return { ok: false, error: "invalid url" };
      }
      let u: URL;
      try {
        u = new URL(url);
      } catch {
        console.warn(`[shell:openExternal] rejected: unparseable url ${url}`);
        return { ok: false, error: "invalid url" };
      }
      if (u.protocol !== "https:" && u.protocol !== "http:") {
        console.warn(`[shell:openExternal] rejected: protocol ${u.protocol}`);
        return { ok: false, error: "invalid protocol" };
      }
      if (u.username || u.password) {
        console.warn(`[shell:openExternal] rejected: url contains credentials`);
        return { ok: false, error: "credentials in url not allowed" };
      }
      if (!EXTERNAL_URL_ALLOWED_HOSTS.has(u.hostname)) {
        console.warn(`[shell:openExternal] rejected: hostname ${u.hostname} not in allowlist`);
        return { ok: false, error: "host not allowed" };
      }
      await shell.openExternal(url);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  createTray();
  await createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  closeAllOutputWindows();
  if (nextServerProc && !nextServerProc.killed) {
    try { nextServerProc.kill(); } catch {}
  }
});

// Export for other modules
export function getAppUrl() { return appUrl; }
export function getMainWindow() { return mainWindow; }
export { openOutputForRole };
