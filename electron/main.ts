import { app, BrowserWindow, Tray, Menu, nativeImage, session, ipcMain } from "electron";
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

  await mainWindow.loadURL(appUrl);
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

  // IPC registration
  registerScreenIpc(() => appUrl);
  registerAudioIpc();
  registerDialogIpc();
  registerFsIpc();

  // Utility IPC
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("app:platform", () => process.platform);

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
