import { app, BrowserWindow, Tray, Menu, nativeImage, session, ipcMain, shell, safeStorage, systemPreferences } from "electron";
import * as path from "path";
import * as fs from "fs";
import { registerScreenIpc, closeAllOutputWindows, openOutputForRole } from "./ipc/screens";
import { registerAudioIpc, registerNativeAudioIpc, stopAllNativeAudio } from "./ipc/audio";
import { registerDialogIpc } from "./ipc/dialog";
import { registerFsIpc } from "./ipc/fs";
import { registerNdiIpc } from "./ipc/ndi";
import { autoUpdater } from "electron-updater";

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
// Hosted Next.js app URL. Override with PF_APP_URL for staging/local testing.
// The desktop shell is a thin client — all auth/DB/API stays on Vercel and
// no secrets ship inside the .app bundle.
// 2026-08-17: repointed from faithflow-ai.vercel.app to the primary domain
// presentflow.org (the same Vercel project, now aliased). NEXT_PUBLIC_APP_URL
// does NOT drive the load URL — this constant (or PF_APP_URL) does.
const DEFAULT_HOSTED_URL = "https://presentflow.org";
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
  // 2026-07-30 — GitHub Releases hosts for the UpdateBanner "Download the
  // new DMG" click. github.com serves the release page HTML; objects.
  // githubusercontent.com serves the DMG binary (the release download
  // links redirect there). Without these, the openExternal IPC silently
  // returned {ok:false} and the click did nothing on the operator side.
  "github.com",
  "objects.githubusercontent.com",
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
  /^([a-z0-9-]+\.)*presentflow\.org$/i,
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
    const base = process.env.NEXT_PUBLIC_APP_URL || "https://presentflow.org";
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
        // 2026-07-25: rebind Cmd+R to force-reload (ignoreCache) instead
        // of the default soft-reload. Chromium's Code Cache and Service
        // Worker keep bytecode/HTML across soft reloads, so after a
        // Vercel push the app appears to ignore the update until the
        // caches age out or the user manually nukes them. Since the
        // desktop app is a thin client (all logic on Vercel), stale
        // cache is the #1 cause of "I don't see the new feature."
        // Force-reload adds ~200 ms but guarantees the latest bundle.
        {
          label: "Reload",
          accelerator: isMac ? "Cmd+R" : "Ctrl+R",
          click: () => {
            const wc = mainWindow?.webContents;
            if (wc) {
              try { wc.session.clearCache(); } catch { /* non-fatal */ }
              wc.reloadIgnoringCache();
            }
          },
        },
        // 2026-07-25 Bug-5 (tester stale-build): replace the stock
        // forceReload role (same Cmd+Shift+R accelerator) with a
        // deeper "clear cache and reload" that also drops Service
        // Workers, CacheStorage, and the GPU shader cache — stores a
        // plain reloadIgnoringCache leaves intact. Deliberately does NOT
        // clear localStorage/cookies: that would sign the operator out
        // and wipe their audio/display settings mid-troubleshoot.
        {
          label: "Clear Cache and Reload",
          accelerator: isMac ? "Cmd+Shift+R" : "Ctrl+Shift+R",
          click: () => {
            const wc = mainWindow?.webContents;
            if (!wc) return;
            void Promise.resolve()
              .then(() => wc.session.clearCache())
              .then(() => wc.session.clearStorageData({ storages: ["serviceworkers", "cachestorage", "shadercache"] }))
              .catch((e: unknown) => { console.warn("[menu] clear-cache failed (reloading anyway)", e); })
              .then(() => { wc.reloadIgnoringCache(); });
          },
        },
        { role: "toggleDevTools" },
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
    // A real tray icon — an EMPTY image renders NOTHING in the Windows
    // notification area, so a hidden window would be unrecoverable except via
    // the taskbar. Load the branded icon (multi-DPI .ico on Windows, .png
    // elsewhere); fall back to empty only if the asset is missing.
    const iconFile = process.platform === "win32" ? "tray-icon.ico" : "tray-icon.png";
    let icon = nativeImage.createFromPath(path.join(__dirname, "..", "electron", iconFile));
    if (icon.isEmpty()) icon = nativeImage.createEmpty();
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
      backgroundThrottling: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  mainWindow.webContents.setBackgroundThrottling(false);

  // 2026-08-16 — universal right-click Copy/Cut/Paste/Select-All. Chromium shows
  // NO context menu by default in a packaged Electron app, so the operator could
  // only paste with ⌘V. This gives a native edit menu on EVERY editable field
  // and text selection across the whole app — rename song, theme editing, new
  // slide text, Bible search, slide content, anywhere — in one place. Clipboard
  // interop with other apps/browsers is native (the OS clipboard).
  mainWindow.webContents.on("context-menu", (_event, params) => {
    const hasSelection = !!params.selectionText && params.selectionText.trim().length > 0;
    if (!params.isEditable && !hasSelection) return;
    const template: Electron.MenuItemConstructorOptions[] = [];
    if (params.isEditable) template.push({ label: "Cut", role: "cut", enabled: params.editFlags.canCut });
    template.push({ label: "Copy", role: "copy", enabled: params.editFlags.canCopy });
    if (params.isEditable) template.push({ label: "Paste", role: "paste", enabled: params.editFlags.canPaste });
    template.push({ type: "separator" }, { label: "Select All", role: "selectAll", enabled: params.editFlags.canSelectAll });
    try { Menu.buildFromTemplate(template).popup({ window: mainWindow ?? undefined }); } catch { /* window torn down */ }
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
    // Kill any ffmpeg subprocesses tied to this window's audio session so
    // they don't zombie past the operator UI closing.
    void stopAllNativeAudio();
  });

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

  const splashPath = path.join(__dirname, "..", "electron", "splash.html");

  const setSplashStatus = (text: string) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.executeJavaScript(`window.pfSetStatus && window.pfSetStatus(${JSON.stringify(text)})`).catch(() => { /* noop */ });
  };

  // The URL to recover to after a LATER failure/crash. Never the one-time
  // device-exchange URL (its token is single-use) — the session cookie is set
  // after the first successful load, so the base app URL reloads cleanly.
  const recoveryUrl = appUrl + (appUrl.includes("?") ? "&" : "?") + "ff_shell=desktop";

  // Load the real app with self-recovery. A bundled splash paints instantly
  // (zero network) so the window is never blank; on failure we keep retrying
  // with backoff INDEFINITELY (capped at 8s) rather than dead-ending on a
  // "quit and reopen" message — a live service must self-heal the moment the
  // connection returns. Re-entrancy-guarded so overlapping triggers (a
  // did-fail-load firing during an in-flight retry) don't stack.
  let recovering = false;
  // `firstTarget` may be the single-use device-exchange URL (cold deep-link
  // launch); every RETRY uses `retryTarget` (the base URL) so a blip after the
  // token was consumed can't re-request a spent token and clear the session
  // (which would drop the operator to /login mid-setup).
  const loadWithRecovery = async (firstTarget: string, retryTarget: string) => {
    if (recovering || !mainWindow || mainWindow.isDestroyed()) return;
    recovering = true;
    try {
      try { await mainWindow.loadFile(splashPath); } catch { /* noop */ }
      let attempt = 0;
      while (mainWindow && !mainWindow.isDestroyed()) {
        attempt += 1;
        const target = attempt === 1 ? firstTarget : retryTarget;
        try {
          if (attempt > 1) setSplashStatus(`Reconnecting… (attempt ${attempt})`);
          await mainWindow.loadURL(target);
          return; // success — real app is now loaded, splash is gone
        } catch (err) {
          console.error(`[main] load attempt ${attempt} failed:`, err instanceof Error ? err.message : err);
          // A failed loadURL leaves Chromium's error page up — restore our
          // splash so the operator sees a branded "reconnecting" state, not a
          // browser error, and keep retrying.
          try { await mainWindow.loadFile(splashPath); } catch { /* noop */ }
          setSplashStatus("Can't reach Present Flow — reconnecting automatically when your connection returns…");
          await new Promise((r) => setTimeout(r, Math.min(1500 * attempt, 8000)));
        }
      }
    } finally {
      recovering = false;
    }
  };

  // Mid-session recovery: a network drop or a renderer crash after the app has
  // loaded must re-show the splash and reload, never a dead Chromium page.
  mainWindow.webContents.on("did-fail-load", (_e, errorCode, _desc, _url, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return; // sub-resource / ERR_ABORTED — not a real failure
    void loadWithRecovery(recoveryUrl, recoveryUrl);
  });
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    if (details.reason === "clean-exit") return; // orderly teardown, not a crash
    console.warn(`[main] render-process-gone: ${details.reason} — recovering`);
    void loadWithRecovery(recoveryUrl, recoveryUrl);
  });

  await loadWithRecovery(initialUrl, recoveryUrl);
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

  // Cache hygiene (2026-08-15): the shell is a thin client that loads the hosted
  // renderer. Clear the HTTP cache on every launch so BOTH the operator window
  // AND the chromeless projector output window always boot the LATEST deployed
  // renderer build. The projector window can't be deep-reloaded (⌘⇧R) by the
  // operator, so without this a web deploy could keep serving it stale code
  // (the exact "projector shows old layout / doesn't update" failure). The
  // service worker is already a disabled pass-through, so HTTP cache is the only
  // staleness source; assets are simply re-fetched once on launch (online app).
  try {
    await session.defaultSession.clearCache();
    // DURABLE FIX (2026-08-28): also purge any leftover SERVICE WORKER + Cache
    // Storage on every launch — BEFORE any window loads the app. A stale service
    // worker from an older build pins the desktop to an old cached JS bundle that
    // re-registers itself in a reload loop, tearing the audio WebSocket down every
    // 1-2s (the recurring "AI keeps dropping / fresh DMG fixes it" outage). Nuking
    // it here guarantees the freshly-deployed renderer loads clean every time.
    await session.defaultSession.clearStorageData({ storages: ["serviceworkers", "cachestorage"] });
    console.log("[main] cleared HTTP cache + service workers on launch (fresh renderer for all windows)");
  } catch (e) {
    console.warn("[main] cache/SW clear on launch failed (continuing)", e);
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
  // Wave 1: native ffmpeg-backed audio capture. Additive — the legacy
  // getUserMedia handlers above remain intact for the existing renderer path.
  // Wave 2 (renderer) opts in to the native path when isAvailable() returns
  // true. See electron/audio/nativeCapture.ts for context on why this
  // exists (Chromium silent 32-channel capture, JPD field failure).
  registerNativeAudioIpc(() => mainWindow);
  registerDialogIpc();
  registerFsIpc();
  // NDI output (spec §17/§24). Owns its own offscreen render window + native
  // sender; auto-starts if the persisted settings enable it. Uses the resolved
  // hosted app URL to load the /ndi surface. UNVERIFIED — needs the native addon
  // compiled + on-site OBS test.
  try { registerNdiIpc(appUrl); } catch (e) { console.warn("[main] NDI IPC init failed:", e instanceof Error ? e.message : String(e)); }

  // Utility IPC
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("app:platform", () => process.platform);

  // 2026-08-16 — same-machine live-sync RELAY (operator ↔ projector/stage/
  // livestream). BroadcastChannel proved unreliable across separate Electron
  // BrowserWindows, leaving the projector stuck ("Operator disconnected") and
  // missing updates like a translation switch. Every LiveMessage a renderer
  // posts is mirrored here and fanned out to ALL OTHER windows' webContents —
  // a delivery path independent of BroadcastChannel. Fire-and-forget; the
  // renderer dedups against the BroadcastChannel copy by message id. The
  // payload is opaque here (validated on the receiving renderer, as it already
  // is for BroadcastChannel), so no trust is added by this hop.
  ipcMain.on("pf:live", (e, msg) => {
    const senderId = e.sender.id;
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      const wc = win.webContents;
      if (!wc || wc.isDestroyed() || wc.id === senderId) continue;
      try { wc.send("pf:live", msg); } catch { /* window torn down mid-send */ }
    }
  });

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

  // electron-updater: only active in packaged AND signed builds. Squirrel.Mac
  // (the macOS auto-update flow electron-updater delegates to) hard-requires a
  // valid code signature match between the current app and the downloaded
  // update — unsigned tester builds hit the exact "code failed to satisfy
  // specified code requirement(s)" error from the 2026-07-24 field report the
  // moment a new GitHub release is discovered. There's no runtime workaround;
  // Squirrel enforces this at the macOS level. Gate the whole updater path
  // behind a runtime code-signature check so unsigned builds never even
  // discover a new release. When Apple Developer enrollment lands and builds
  // start shipping signed, this predicate flips true and auto-updates start
  // working automatically — no code change needed.
  const isCurrentAppSigned = (): boolean => {
    if (process.platform !== "darwin") return true; // gate is mac-specific
    if (!app.isPackaged) return false;
    try {
      // codesign returns 0 with a signing identity when the bundle is signed
      // by a Developer ID cert, non-zero (or "not signed at all") otherwise.
      // Using execFileSync (100ms typical) once at startup — not in a hot path.
      const { execFileSync } = require("node:child_process");
      const bundlePath = app.getAppPath().replace(/\/Contents\/Resources\/app(?:\.asar)?$/, "");
      const out = execFileSync("codesign", ["-dv", bundlePath], { stdio: ["ignore", "pipe", "pipe"] }).toString()
        + execFileSync("codesign", ["-dv", bundlePath], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
      return /Authority=Developer ID/i.test(out);
    } catch {
      return false;
    }
  };

  if (app.isPackaged && isCurrentAppSigned()) {
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
  } else if (app.isPackaged) {
    console.log("[updater] skipped: unsigned build (Squirrel.Mac requires matching Developer ID signatures). Manual re-install required for updates.");
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
  // Belt-and-braces — window "closed" handler above already stops native
  // audio, but before-quit fires even when the app is quit without closing
  // windows first (Cmd+Q, tray Quit).
  void stopAllNativeAudio();
});

// Export for other modules
export function getAppUrl() { return appUrl; }
export function getMainWindow() { return mainWindow; }
export { openOutputForRole };
