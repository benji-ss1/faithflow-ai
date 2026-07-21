import { app, BrowserWindow, Tray, Menu, nativeImage, session, ipcMain, shell, safeStorage, systemPreferences } from "electron";
import * as path from "path";
import * as fs from "fs";
import { registerScreenIpc, closeAllOutputWindows, openOutputForRole } from "./ipc/screens";
import { registerAudioIpc } from "./ipc/audio";
import { registerDialogIpc } from "./ipc/dialog";
import { registerFsIpc } from "./ipc/fs";
import { autoUpdater } from "electron-updater";

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
// Hosted Next.js app URL. Override with PF_APP_URL for staging/local testing.
// The desktop shell is a thin client — all auth/DB/API stays on Vercel and
// no secrets ship inside the .app bundle.
const DEFAULT_HOSTED_URL = "https://faithflow-ai.vercel.app";
let mainWindow: BrowserWindow | null = null;
// Set when a presentflow://auth?token=... deep link arrives before the main
// window exists yet (cold launch via the link). Consumed once by
// createMainWindow() so the very first page load goes straight to the
// exchange route instead of the default hosted URL.
let pendingDeepLinkToken: string | null = null;
let tray: Tray | null = null;
let appUrl = DEFAULT_HOSTED_URL;

// First-party hosts allowed to receive the x-pf-shell header. Computed once
// after appUrl is known (see registerFirstPartyHosts). Also used by the
// shell.openExternal handler as part of the allowlist.
const FIRST_PARTY_HOSTS = new Set<string>(["localhost", "127.0.0.1"]);
const EXTERNAL_URL_ALLOWED_HOSTS = new Set<string>([
  "presentflow.app",
  "app.presentflow.com",
  "faithflow-ai.vercel.app",
  // localhost/127.0.0.1 only trusted in dev; in a packaged app there's no
  // first-party local service and allowing them lets an XSS pivot into
  // whatever the tester happens to run locally.
  ...(isDev ? ["localhost", "127.0.0.1"] : []),
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
  /^faithflow-ai\.vercel\.app$/i,
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

// Resolve the URL the desktop shell should point at.
//   1. `PF_APP_URL` env override (dev/staging).
//   2. In dev: http://localhost:${PRESENTFLOW_DEV_PORT || 3000}.
//   3. Otherwise: the hosted production URL.
// The desktop app no longer runs its own Next server — see DECISIONS.md.
function resolveAppUrl(): string {
  const override = process.env.PF_APP_URL;
  if (override) {
    try {
      const u = new URL(override);
      if (u.protocol === "http:" || u.protocol === "https:") return override.replace(/\/$/, "");
      console.warn(`[main] Ignoring PF_APP_URL with unsupported protocol: ${u.protocol}`);
    } catch {
      console.warn(`[main] Ignoring unparseable PF_APP_URL: ${override}`);
    }
  }
  if (isDev) {
    const devPort = process.env.PRESENTFLOW_DEV_PORT || "3000";
    return `http://localhost:${devPort}`;
  }
  return DEFAULT_HOSTED_URL;
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
    minWidth: 1100,
    minHeight: 700,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => { mainWindow = null; });

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  // Lock navigation to the appUrl origin. A compromised page in the hosted
  // Next app must not be able to redirect the shell to a third-party origin
  // and keep IPC access to preload.
  try {
    const trustedOrigin = new URL(appUrl).origin;
    mainWindow.webContents.on("will-navigate", (e, url) => {
      try {
        if (new URL(url).origin !== trustedOrigin) {
          e.preventDefault();
          void shell.openExternal(url).catch(() => { /* noop */ });
        }
      } catch { e.preventDefault(); }
    });
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url).catch(() => { /* noop */ });
      return { action: "deny" };
    });
  } catch { /* invalid appUrl; loadURL below will fail loudly */ }

  mainWindow.webContents.on(
    "did-fail-load",
    (_e, code, desc, url) => {
      console.error(`[main] did-fail-load ${code} ${desc} → ${url}`);
    }
  );
  if (isDev) {
    mainWindow.webContents.on(
      "console-message",
      (_e, level, message, line, sourceId) => {
        console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
      }
    );
  }

  let initialUrl: string;
  if (pendingDeepLinkToken) {
    initialUrl = `${appUrl}/api/auth/device-exchange?token=${encodeURIComponent(pendingDeepLinkToken)}`;
    pendingDeepLinkToken = null;
  } else {
    initialUrl = appUrl + (appUrl.includes("?") ? "&" : "?") + "ff_shell=desktop";
  }
  await mainWindow.loadURL(initialUrl);
}

// Web-to-desktop auto-login: the website's download page mints a one-time
// token and links to presentflow://auth?token=... . We only ever pull the
// `token` query param out of this — we never load the deep-link URL itself
// in the window, we build our own trusted same-origin URL to navigate to.
// This can't be used to make the shell navigate anywhere other than our own
// /api/auth/device-exchange route.
function extractTokenFromDeepLink(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "presentflow:") return null;
    return u.searchParams.get("token");
  } catch {
    return null;
  }
}

function handleDeepLink(raw: string) {
  const token = extractTokenFromDeepLink(raw);
  if (!token) return;
  if (mainWindow) {
    // Intentionally clobbers whatever the window was showing, no confirm
    // prompt — this only fires from a presentflow://auth link the user
    // just clicked themselves, so navigating immediately is the expected
    // behavior, not a surprise interruption. device-exchange also clears
    // any existing session first (see route.ts) so a warm-launch deep link
    // cleanly replaces the active identity rather than layering on top.
    mainWindow.loadURL(`${appUrl}/api/auth/device-exchange?token=${encodeURIComponent(token)}`);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } else {
    pendingDeepLinkToken = token;
  }
}

// Register the custom protocol as early as possible, per Electron's own
// guidance. `process.defaultApp` is true in dev (running via plain `electron
// .`), where we have to pass through the script path for the OS to relaunch
// correctly; packaged builds just register directly.
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("presentflow", process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient("presentflow");
}

// macOS delivers the deep link via this event, including at cold launch
// (before 'ready') — Electron queues it until we attach a listener.
app.on("open-url", (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

// Windows/Linux instead pass the URL as an argv entry. Cold-launch case:
if (!process.defaultApp) {
  const argvUrl = process.argv.find((a) => a.startsWith("presentflow://"));
  if (argvUrl) pendingDeepLinkToken = extractTokenFromDeepLink(argvUrl);
}

// Enforce single-instance: a second launch (double-click, or a deep-link
// open while already running) just refocuses the existing window instead of
// spawning a duplicate BrowserWindow that races the same license.enc file
// and BroadcastChannel state. On Windows/Linux, a deep-link relaunch shows
// up here as argv on the *second* process, forwarded to the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const argvUrl = argv.find((a) => a.startsWith("presentflow://"));
    if (argvUrl) {
      handleDeepLink(argvUrl);
      return;
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  // Only auto-approve permissions the operator UI actually needs. Anything
  // else (geolocation, notifications, midi…) must be denied — a compromised
  // page mustn't be able to escalate silently.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    const allowed = new Set([
      "media",
      "audioCapture",
      "videoCapture",
      "display-capture",
    ]);
    cb(allowed.has(permission as string));
  });

  // Proactively surface the macOS mic-access state at launch rather than
  // waiting for the renderer's lazy getUserMedia call to trigger it. This
  // matters specifically because the app ships unsigned (hardenedRuntime
  // true, identity null — see DECISIONS.md, blocked on Apple Developer
  // enrollment) which is a known combination that can leave TCC never
  // showing a permission dialog at all, so getUserMedia just rejects with
  // no way to tell "never asked" from "user said no." This doesn't fix that
  // — only real code signing does — but it makes the state diagnosable
  // (logged here, and exposed to the renderer via audio:getMicPermissionStatus
  // in electron/ipc/audio.ts) instead of a silent black box.
  if (process.platform === "darwin") {
    try {
      const status = systemPreferences.getMediaAccessStatus("microphone");
      console.log(`[main] macOS microphone access status at launch: ${status}`);
      if (status !== "granted") {
        const granted = await systemPreferences.askForMediaAccess("microphone");
        console.log(`[main] askForMediaAccess("microphone") resolved: ${granted}`);
      }
    } catch (err) {
      console.warn("[main] mic permission check failed", err);
    }
  }

  // Thin-client shell: point at the hosted Next.js app (or dev/staging
  // override via PF_APP_URL). No local Next server, no local audio bridge —
  // the hosted app talks to the Fly.io Deepgram bridge via
  // NEXT_PUBLIC_AUDIO_WS_URL configured server-side on Vercel.
  appUrl = resolveAppUrl();
  console.log(`[main] shell loading appUrl=${appUrl}`);

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

  // electron-updater: only active in packaged builds. Pulls .zip + latest-mac.yml
  // from the GitHub Release feed (configured in package.json build.publish) and
  // atomically swaps the app on next restart. Signed builds get automatic
  // signature verification; unsigned tester builds fall back to zip replace.
  if (app.isPackaged) {
    try {
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.on("update-available", (info) => {
        try {
          mainWindow?.webContents.send("update:available", {
            version: info.version,
            releaseDate: info.releaseDate,
          });
        } catch { /* noop */ }
      });
      autoUpdater.on("update-downloaded", (info) => {
        try {
          mainWindow?.webContents.send("update:downloaded", { version: info.version });
        } catch { /* noop */ }
      });
      autoUpdater.on("error", (err) => {
        console.error("[updater] error", err?.message || err);
        try {
          mainWindow?.webContents.send("update:error", { message: String(err?.message || err) });
        } catch { /* noop */ }
      });
      autoUpdater
        .checkForUpdatesAndNotify()
        .catch((e) => console.error("[updater] initial check failed", e));
      setInterval(
        () => autoUpdater.checkForUpdates().catch((e) => console.error("[updater] periodic check failed", e)),
        60 * 60 * 1000,
      );
    } catch (err) {
      console.error("[updater] setup failed", err);
    }
  }

  ipcMain.handle("update:install-now", () => {
    try {
      autoUpdater.quitAndInstall(false, true);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Manual retry after a stalled download — the renderer's UpdateBanner
  // stall watchdog surfaces a Retry button so the operator doesn't have to
  // quit + relaunch the whole app to trigger another download attempt.
  // Frame-guarded: only the main frame (operator UI) can trigger a retry,
  // not any subframe/iframe that might slip in via a compromised page.
  ipcMain.handle("update:retry-download", async (event) => {
    try {
      const senderFrame = event.senderFrame;
      const isMainFrame = senderFrame ? senderFrame === mainWindow?.webContents.mainFrame : true;
      if (!isMainFrame) {
        return { ok: false, error: "retry only allowed from main frame" };
      }
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  closeAllOutputWindows();
});

// Export for other modules
export function getAppUrl() { return appUrl; }
export function getMainWindow() { return mainWindow; }
export { openOutputForRole };
