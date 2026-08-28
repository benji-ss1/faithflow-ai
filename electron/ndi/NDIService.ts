// PresentFlow NDI output service (Phase 3 — Electron MAIN process).
//
// !!! UNVERIFIED — written to spec but NOT run. Needs: the native addon compiled
//     (native/ndi-sender via electron-rebuild), the app running, and an on-site
//     OBS+DistroAV two-computer test (spec §20/§25). !!!
//
// Orchestrates the native NDI sender (spec §24 API). It owns a HIDDEN OFFSCREEN
// BrowserWindow that renders the /ndi live-output surface at a fixed 1920×1080
// and, on each `paint`, hands the BGRA bitmap to the native addon. This is the
// "Live output renderer → NDI output renderer → NDI sender" chain (§3). It does
// NOT capture the visible window or the desktop (§22).
//
// Guarantees from the spec:
//  - Never crashes the app if NDI is unavailable (§2) — all failures degrade to a
//    status error and a no-op.
//  - Does not block the UI thread (§9) — paint + async send happen off the main
//    window's work; the offscreen window is its own webContents.
//  - Live-state only (§4) — /ndi subscribes to the live channel; preview never
//    reaches it. Clear → transparent frame (§5).
//  - Keeps broadcasting with 0 receivers (§19).

import { BrowserWindow } from "electron";
import * as path from "path";

export type NdiOutputMode = "transparent" | "full";
export interface NdiSettings {
  enabled: boolean;
  sourceName: string;      // §2 default "PresentFlow - NDI 1"
  mode: NdiOutputMode;     // §7 default "transparent"
  width: number;           // §8 default 1920
  height: number;          // §8 default 1080
  fps: number;             // §9 default 60
  audio: boolean;          // §13 default false
}
export interface NdiStatus {
  available: boolean;      // native addon loaded + NDI init ok
  broadcasting: boolean;
  sourceName: string;
  receivers: number;       // §19
  fps: number;
  width: number;
  height: number;
  mode: NdiOutputMode;
  error: string | null;
}

export const NDI_DEFAULTS: NdiSettings = {
  enabled: false,
  sourceName: "PresentFlow - NDI 1",
  mode: "transparent",
  width: 1920,
  height: 1080,
  fps: 60,
  audio: false,
};

// Lazy-load the native addon so a missing/uncompiled addon degrades gracefully.
type NativeSender = { sendFrame(b: Buffer, w: number, h: number, premultiplied?: boolean): void; getConnections(): number; destroy(): void; };
type NativeMod = { NdiSender?: new (name: string, frN?: number, frD?: number) => NativeSender; __loadError?: string };
function loadNative(): { mod: NativeMod | null; error: string | null } {
  // Packaged: extraResources copies native/ndi-sender → <Resources>/native/
  // ndi-sender (outside asar — native .node can't load from inside asar). Dev:
  // resolve relative to the compiled dist-electron/ndi dir.
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, "native", "ndi-sender") : null,
    path.join(__dirname, "..", "..", "native", "ndi-sender"),
  ].filter(Boolean) as string[];
  let lastErr = "NDI addon not found";
  for (const p of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(p) as NativeMod;
      if (mod.__loadError) { lastErr = mod.__loadError; continue; }
      if (!mod.NdiSender) { lastErr = "ndi_sender addon missing NdiSender export"; continue; }
      return { mod, error: null };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  return { mod: null, error: lastErr };
}

export class NDIService {
  private appUrl: string;
  private settings: NdiSettings = { ...NDI_DEFAULTS };
  private win: BrowserWindow | null = null;
  private sender: NativeSender | null = null;
  private receivers = 0;
  private receiverPoll: NodeJS.Timeout | null = null;
  private error: string | null = null;
  private broadcasting = false;
  // Frame-rate governance (§9): if paints can't keep up, fall back 60→30.
  private lastPaintAt = 0;
  private droppedInARow = 0;

  constructor(appUrl: string) { this.appUrl = appUrl; }

  // ---- §24 API ----------------------------------------------------------------

  initialize(settings?: Partial<NdiSettings>) {
    this.settings = { ...this.settings, ...(settings || {}) };
  }

  getSettings(): NdiSettings { return { ...this.settings }; }

  async start(): Promise<NdiStatus> {
    if (this.broadcasting) return this.getStatus();
    this.error = null;
    const { mod, error } = loadNative();
    if (!mod || !mod.NdiSender) {
      this.error = error || "NDI native addon unavailable";
      return this.getStatus(); // graceful — app keeps running (§2)
    }
    try {
      // 59.94 (60000/1001) or exact 30/1 — clocked in the addon.
      const frN = this.settings.fps >= 60 ? 60000 : 30000;
      const frD = 1001;
      this.sender = new mod.NdiSender(this.settings.sourceName, frN, frD);
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.sender = null;
      return this.getStatus();
    }
    this.createOffscreenWindow();
    this.broadcasting = true;
    // Poll receiver count for the status UI (§19) — cheap, non-blocking.
    this.receiverPoll = setInterval(() => {
      try { this.receivers = this.sender ? this.sender.getConnections() : 0; } catch { /* ignore */ }
    }, 1000);
    return this.getStatus();
  }

  stop() {
    this.broadcasting = false;
    if (this.receiverPoll) { clearInterval(this.receiverPoll); this.receiverPoll = null; }
    if (this.win && !this.win.isDestroyed()) { try { this.win.destroy(); } catch { /* ignore */ } }
    this.win = null;
    if (this.sender) { try { this.sender.destroy(); } catch { /* ignore */ } this.sender = null; }
    this.receivers = 0;
  }

  setSourceName(name: string) {
    this.settings.sourceName = name || NDI_DEFAULTS.sourceName;
    if (this.broadcasting) { this.restart(); } // source name is set at create time
  }
  setResolution(width: number, height: number) {
    this.settings.width = width; this.settings.height = height;
    if (this.broadcasting) this.restart();
  }
  setFrameRate(fps: number) {
    this.settings.fps = fps;
    if (this.win && !this.win.isDestroyed()) this.win.webContents.setFrameRate(fps);
    if (this.broadcasting) this.restart(); // frame_rate_N/D is set at sender create
  }
  setOutputMode(mode: NdiOutputMode) {
    this.settings.mode = mode;
    if (this.win && !this.win.isDestroyed()) this.win.loadURL(this.ndiUrl());
  }

  getStatus(): NdiStatus {
    return {
      available: !!this.sender,
      broadcasting: this.broadcasting,
      sourceName: this.settings.sourceName,
      receivers: this.receivers,
      fps: this.settings.fps,
      width: this.settings.width,
      height: this.settings.height,
      mode: this.settings.mode,
      error: this.error,
    };
  }

  shutdown() { this.stop(); }

  // §18 "Test NDI Output": show the known alpha test pattern for `ms`, then
  // return to live. Lets the media team confirm OBS is receiving PresentFlow.
  private testTimer: NodeJS.Timeout | null = null;
  showTestPattern(on: boolean, ms = 15000) {
    if (this.testTimer) { clearTimeout(this.testTimer); this.testTimer = null; }
    this.testMode = on;
    if (this.win && !this.win.isDestroyed()) this.win.loadURL(this.ndiUrl());
    if (on && ms > 0) this.testTimer = setTimeout(() => { this.testMode = false; if (this.win && !this.win.isDestroyed()) this.win.loadURL(this.ndiUrl()); }, ms);
  }
  private testMode = false;

  // ---- internals --------------------------------------------------------------

  private restart() { this.stop(); void this.start(); }

  private ndiUrl(): string {
    // The offscreen surface built in Phase 1. Live-only; §4/§5 enforced there.
    const test = this.testMode ? "&test=1" : "";
    return `${this.appUrl}/ndi?mode=${this.settings.mode}${test}`;
  }

  private createOffscreenWindow() {
    const { width, height, fps } = this.settings;
    this.win = new BrowserWindow({
      width, height,
      show: false,
      frame: false,
      transparent: true,               // real alpha in the offscreen bitmap (§6)
      backgroundColor: "#00000000",
      webPreferences: {
        offscreen: true,               // OSR — paint frames without a visible window
        // paintWhenInitiallyHidden defaults true; be explicit.
        // A preload that enables the pf:live IPC relay makes live-state delivery
        // reliable across BrowserWindows (BroadcastChannel alone proved flaky —
        // see broadcast.ts note). Reuse the main preload.
        preload: path.join(__dirname, "..", "preload.js"),
        backgroundThrottling: false,
        sandbox: false,
      },
    });
    const wc = this.win.webContents;
    // Software OSR is the reliable-alpha path; if GPU OSR flattens alpha, the app
    // must be launched with app.disableHardwareAcceleration() — see the spec doc.
    wc.setFrameRate(fps);
    wc.on("paint", (_event, _dirty, image) => {
      if (!this.sender) return;
      try {
        // Graceful 60→30 fallback (§9): if paints bunch up (system can't sustain
        // 60), halve the requested rate rather than freeze.
        const now = Date.now();
        const dt = now - this.lastPaintAt;
        this.lastPaintAt = now;
        if (fps >= 60 && dt > 0 && dt < 10) {
          if (++this.droppedInARow > 30) { wc.setFrameRate(30); this.settings.fps = 30; this.droppedInARow = 0; }
        } else {
          this.droppedInARow = 0;
        }
        const size = image.getSize();
        // toBitmap() → BGRA, premultiplied, top-left origin (getBitmap is a
        // deprecated void-typed alias in Electron 43).
        const bmp = image.toBitmap();
        this.sender.sendFrame(bmp, size.width, size.height, true);
      } catch { /* never crash the app (§2) */ }
    });
    wc.on("render-process-gone", () => { this.error = "NDI offscreen renderer crashed"; });
    this.win.loadURL(this.ndiUrl()).catch((e) => {
      this.error = e instanceof Error ? e.message : String(e);
    });
  }
}
