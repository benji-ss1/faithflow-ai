import { app, BrowserWindow, Tray, Menu, nativeImage, session, ipcMain, shell, safeStorage } from "electron";
import * as path from "path";
import * as fs from "fs";
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
let audioServerProc: ChildProcess | null = null;
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

// S3: Hardened allowlist for hosts derived from NEXT_PUBLIC_APP_URL. The
// env var can be anything at runtime — we must NOT blindly trust it or a
// misconfigured/malicious value could add `evil.com` to the external-URL
// allowlist. Only accept env-derived hosts that match this static safe set.
const STATIC_SAFE_HOST_ALLOWLIST: ReadonlyArray<RegExp> = [
  /^localhost$/i,
  /^127\.0\.0\.1$/,
  /^([a-z0-9-]+\.)*presentflow\.app$/i,
  /^([a-z0-9-]+\.)*presentflow\.com$/i,
];
function isStaticSafeHost(hostname: string): boolean {
  return STATIC_SAFE_HOST_ALLOWLIST.some((re) => re.test(hostname));
}

function registerFirstPartyHosts() {
  // `appUrl` at this point is one of:
  //   - The launcher-picked http://127.0.0.1:<port> (production standalone), or
  //   - http://localhost:<devPort> (dev).
  // Both are trusted by construction — we opened them.
  try {
    const u = new URL(appUrl);
    FIRST_PARTY_HOSTS.add(u.host);
    if (isStaticSafeHost(u.hostname)) EXTERNAL_URL_ALLOWED_HOSTS.add(u.hostname);
  } catch {}
  const envUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (envUrl) {
    try {
      const u = new URL(envUrl);
      // Only trust the env-derived host if it matches the static safe set.
      // Ignore anything else so a mis-set env var can't widen either list.
      if (isStaticSafeHost(u.hostname)) {
        FIRST_PARTY_HOSTS.add(u.host);
        EXTERNAL_URL_ALLOWED_HOSTS.add(u.hostname);
      } else {
        console.warn(`[main] Ignoring NEXT_PUBLIC_APP_URL host not in static safe list: ${u.hostname}`);
      }
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

// Build the application menu bar. Help items open URLs in the SYSTEM browser
// (via `shell.openExternal`) instead of navigating the Electron window — the
// desktop shell renders only the single operator view; help/tutorial pages
// live on the web build and stay out of the desktop chrome by design.
function installApplicationMenu() {
  const openHelp = (path: string) => {
    // Y10: Help menu items were calling shell.openExternal directly, bypassing
    // the shell:openExternal IPC handler's allowlist. If NEXT_PUBLIC_APP_URL
    // gets misconfigured (e.g., someone points it at a staging host that later
    // expires and gets squatted), we would happily open the malicious URL.
    // Validate against the same static safe host list the IPC handler uses.
    const base = process.env.NEXT_PUBLIC_APP_URL || "https://presentflow.app";
    let u: URL;
    try {
      u = new URL(base.replace(/\/$/, "") + path);
    } catch {
      console.warn(`[menu] openHelp rejected: unparseable url from base=${base} path=${path}`);
      return;
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      console.warn(`[menu] openHelp rejected: protocol ${u.protocol}`);
      return;
    }
    if (!isStaticSafeHost(u.hostname)) {
      console.warn(`[menu] openHelp rejected: hostname ${u.hostname} not in static safe list`);
      return;
    }
    void shell.openExternal(u.toString()).catch(() => { /* noop */ });
  };
  const isMac = process.platform === "darwin";
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: "about" as const },
        { type: "separator" as const },
        { role: "hide" as const },
        { role: "hideOthers" as const },
        { role: "unhide" as const },
        { type: "separator" as const },
        { role: "quit" as const },
      ],
    }] : []),
    {
      label: "File",
      submenu: [
        isMac ? { role: "close" as const } : { role: "quit" as const },
      ],
    },
    { label: "Edit", submenu: [
        { role: "undo" }, { role: "redo" }, { type: "separator" },
        { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
    ] },
    { label: "View", submenu: [
        { role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" },
        { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
        { type: "separator" }, { role: "togglefullscreen" },
    ] },
    { label: "Help", submenu: [
        {
          label: "Keyboard Shortcuts",
          accelerator: isMac ? "Cmd+/" : "Ctrl+/",
          click: () => {
            if (!mainWindow) return;
            mainWindow.show();
            const wc = mainWindow.webContents;
            const send = () => {
              try { wc.send("shell:open-shortcuts-help"); } catch { /* noop */ }
            };
            // Y3: if the renderer is still loading, the IPC event is
            // dropped before any listener is attached. Queue it on
            // did-finish-load and also fire a delayed retry to cover the
            // gap between load and React effect mount.
            if (wc.isLoading()) {
              wc.once("did-finish-load", () => {
                send();
                setTimeout(send, 500);
              });
            } else {
              send();
              setTimeout(send, 500);
            }
          },
        },
        { type: "separator" as const },
        {
          label: "Guided Tutorial",
          click: () => {
            // In-app tour overlay (not an external URL) — mirrors the
            // Keyboard Shortcuts pattern above so the tour renders on top of
            // the live operator console instead of opening a browser window.
            if (!mainWindow) return;
            mainWindow.show();
            const wc = mainWindow.webContents;
            const send = () => { try { wc.send("shell:open-tour"); } catch { /* noop */ } };
            if (wc.isLoading()) {
              wc.once("did-finish-load", () => { send(); setTimeout(send, 500); });
            } else {
              send();
              setTimeout(send, 500);
            }
          },
        },
        { label: "First Sunday Playbook", click: () => openHelp("/help/first-sunday") },
        { label: "Projector Setup", click: () => openHelp("/setup/projector") },
        { label: "Microphone Setup", click: () => openHelp("/setup/audio") },
        { label: "Install Diagnostics", click: () => openHelp("/setup/diagnostics") },
    ] },
  ];
  try {
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  } catch (err) {
    console.warn("Failed to install app menu:", err);
  }
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

// Y4: Tray "Open Screen Config" — /settings/screens is no longer reachable
// from the desktop shell (middleware redirects it away). Instead, show the
// main window and broadcast an IPC event the renderer listens for; the
// renderer opens the Screens modal directly (see TopToolbar wiring).
function openScreenConfig() {
  if (!mainWindow) return;
  mainWindow.show();
  try { mainWindow.webContents.send("shell:open-screens-modal"); } catch { /* noop */ }
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
    // Auto-start the local audio-server (WebSocket bridge to Deepgram) so the
    // AI Live pill isn't stuck showing "AI error" in a fresh dev environment.
    // The subprocess reads .env.local for DEEPGRAM_API_KEY + AUTH_SECRET; if
    // spawn fails we log and continue — Electron shouldn't die because the
    // audio bridge can't start.
    try {
      const appRoot = path.resolve(__dirname, "..");
      const tsxCli = require.resolve("tsx/cli", { paths: [appRoot] });
      audioServerProc = spawn(
        process.execPath,
        [tsxCli, "scripts/audio-server.ts"],
        {
          cwd: appRoot,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      audioServerProc.stdout?.on("data", (d) => process.stdout.write(`[ws-server] ${d}`));
      audioServerProc.stderr?.on("data", (d) => process.stderr.write(`[ws-server!] ${d}`));
      audioServerProc.on("exit", (code, sig) => {
        console.warn(`[ws-server] exited code=${code} sig=${sig}`);
        audioServerProc = null;
      });
      // Wait up to ~5s for the audio bridge to answer HTTP on 3001, then
      // continue regardless — startup shouldn't block on it.
      const audioPort = Number(process.env.AUDIO_WS_PORT || 3001);
      const audioHealth = `http://127.0.0.1:${audioPort}/`;
      const startWait = Date.now();
      while (Date.now() - startWait < 5000) {
        try {
          await new Promise<void>((resolve, reject) => {
            const req = require("http").get(audioHealth, (res: any) => {
              res.destroy();
              if (res.statusCode && res.statusCode < 500) resolve(); else reject(new Error("bad status"));
            });
            req.on("error", reject);
            req.setTimeout(400, () => req.destroy(new Error("timeout")));
          });
          console.log(`[ws-server] ready on port ${audioPort}`);
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 250));
        }
      }
    } catch (err) {
      console.warn("[ws-server] failed to spawn audio bridge:", err);
    }
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
      // Accept if in the (post-init) Set of first-party-derived hosts OR if
      // the hostname matches the static safe list (covers new subdomains
      // like docs.presentflow.app without needing an env restart).
      const allowed = EXTERNAL_URL_ALLOWED_HOSTS.has(u.hostname) || isStaticSafeHost(u.hostname);
      if (!allowed) {
        console.warn(`[shell:openExternal] rejected: hostname ${u.hostname} not in allowlist`);
        return { ok: false, error: "host not allowed" };
      }
      await shell.openExternal(url);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  // Y3: license key storage backed by the OS keychain via safeStorage.
  // Writes an encrypted blob under userData/license.enc so the raw key is
  // never in localStorage/plaintext on disk. If safeStorage isn't available
  // on this platform, the handlers return null so the renderer falls back
  // to (clearly-labelled) localStorage on web.
  const licenseFilePath = () => path.join(app.getPath("userData"), "license.enc");
  ipcMain.handle("license:get", async () => {
    try {
      if (!safeStorage.isEncryptionAvailable()) return { ok: false, key: null, reason: "unavailable" };
      const p = licenseFilePath();
      if (!fs.existsSync(p)) return { ok: true, key: null };
      const buf = fs.readFileSync(p);
      const key = safeStorage.decryptString(buf);
      return { ok: true, key };
    } catch (err) {
      return { ok: false, key: null, reason: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle("license:set", async (_e, key: unknown) => {
    try {
      if (typeof key !== "string") return { ok: false, reason: "invalid key" };
      if (!safeStorage.isEncryptionAvailable()) return { ok: false, reason: "unavailable" };
      const enc = safeStorage.encryptString(key);
      fs.writeFileSync(licenseFilePath(), enc, { mode: 0o600 });
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle("license:clear", async () => {
    try {
      const p = licenseFilePath();
      if (fs.existsSync(p)) fs.unlinkSync(p);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  });

  installApplicationMenu();
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
  if (audioServerProc && !audioServerProc.killed) {
    try { audioServerProc.kill(); } catch {}
  }
});

// Export for other modules
export function getAppUrl() { return appUrl; }
export function getMainWindow() { return mainWindow; }
export { openOutputForRole };
