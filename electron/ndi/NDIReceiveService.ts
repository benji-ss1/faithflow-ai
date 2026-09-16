// PresentFlow NDI AUDIO RECEIVE service (Electron MAIN process).
//
// !!! UNVERIFIED — needs the native addon compiled (native/ndi-receiver via
//     electron-rebuild on Windows) + an on-site test against the church's OBS +
//     DistroAV NDI source. !!!
//
// Owns the native NDI receiver addon. It:
//   - discovers NDI sources on the LAN (like OBS/DistroAV) and lists them,
//   - connects to a chosen source and receives its AUDIO only,
//   - down-mixes to mono + resamples to 16 kHz (the rate the Deepgram/Fly pipeline
//     wants) and forwards the PCM to the renderer via IPC — where it enters the
//     SAME path as a locally-connected USB device (useAudioStream onPcmChunk).
//
// This removes the need for a physical USB cable from the mixer: the broadcast PC
// keeps the USB interface while PresentFlow receives the same feed over NDI.
// Receive-only; never sends. Never crashes the app if NDI is unavailable.

import { BrowserWindow } from "electron";
import * as path from "path";

export interface NdiSourceInfo { name: string; urlAddress: string; }
export interface NdiReceiveStatus {
  available: boolean;   // native addon loaded + NDI init ok
  connected: boolean;
  sourceName: string | null;
  error: string | null;
}

const TARGET_RATE = 16000; // Deepgram/Fly pipeline rate (linear16 mono)

// ---- native addon (lazy, graceful) -----------------------------------------
type NativeReceiver = {
  listSources(): NdiSourceInfo[];
  connect(sourceName: string, onAudio: (pcm: Buffer, sampleRate: number, channels: number) => void): boolean;
  disconnect(): void;
  isConnected(): boolean;
};
type NativeMod = { NdiReceiver?: new () => NativeReceiver; __loadError?: string };

function loadNative(): { mod: NativeMod | null; error: string | null } {
  // Packaged: extraResources copies native/ndi-receiver → <Resources>/native/
  // ndi-receiver (outside asar — native .node can't load from inside asar). Dev:
  // resolve relative to the compiled dist-electron/ndi dir.
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, "native", "ndi-receiver") : null,
    path.join(__dirname, "..", "..", "native", "ndi-receiver"),
  ].filter(Boolean) as string[];
  let lastErr = "NDI receiver addon not found";
  for (const p of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(p) as NativeMod;
      if (mod.__loadError) { lastErr = mod.__loadError; continue; }
      if (!mod.NdiReceiver) { lastErr = "ndi_receiver addon missing NdiReceiver export"; continue; }
      return { mod, error: null };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  return { mod: null, error: lastErr };
}

// ---- streaming linear resampler (any rate → 16 kHz), stateful across chunks --
class MonoResampler {
  private ratio: number;
  private pos = 0;    // next read position in current-block coords (>= -1)
  private prev = 0;   // last sample of the previous block (source index -1)
  constructor(srcRate: number) { this.ratio = srcRate / TARGET_RATE; }
  reset() { this.pos = 0; this.prev = 0; }
  // `x` is mono float32 in [-1,1]; returns Int16 PCM at TARGET_RATE.
  process(x: Float32Array): Int16Array {
    const n = x.length;
    if (n === 0) return new Int16Array(0);
    const step = this.ratio;
    const out: number[] = [];
    let pos = this.pos;
    while (pos <= n - 1) {
      const i = Math.floor(pos);
      if (i + 1 > n - 1) break;               // need s1 within this block
      const frac = pos - i;
      const s0 = i < 0 ? this.prev : x[i];
      const s1 = x[i + 1];
      let s = s0 + (s1 - s0) * frac;
      if (s > 1) s = 1; else if (s < -1) s = -1;
      out.push(s < 0 ? s * 0x8000 : s * 0x7fff);
      pos += step;
    }
    // Shift coords so next block's x[0] is index 0 (this block's last = next.prev).
    this.pos = pos - n;
    this.prev = x[n - 1];
    return Int16Array.from(out, (v) => v | 0);
  }
}

export class NDIReceiveService {
  private getMainWindow: () => BrowserWindow | null;
  private mod: NativeMod | null = null;
  private receiver: NativeReceiver | null = null;
  // A PERSISTENT discovery-only receiver whose NDI finder stays alive across polls.
  // NDIlib_find needs ~1-3s of continuous dwell to discover sources over mDNS; the
  // old code made a throwaway NdiReceiver per 2s poll, so its finder never dwelled
  // and almost always returned 0 sources (even when NDI Tools on the same PC saw
  // them). Keeping one finder alive lets the list populate like OBS/DistroAV do.
  private discovery: NativeReceiver | null = null;
  private error: string | null = null;
  private sourceName: string | null = null;
  private resampler: MonoResampler | null = null;
  // Feed-loss watchdog: the NDI receiver thread stays "connected" even when the
  // source (OBS on the streaming PC) stops sending, so audio silently stops with
  // a lying green LED. Track the last audio arrival; if it dries up while
  // connected, emit ndiAudio:error once and report connected=false so the UI is
  // honest. The SDK auto-resumes when the source returns → the stall clears.
  private lastAudioAt = 0;
  private stalled = false;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private static readonly STALL_MS = 3000;
  private static readonly CONNECT_WAIT_MS = 8000;

  constructor(getMainWindow: () => BrowserWindow | null) {
    this.getMainWindow = getMainWindow;
  }

  private startWatchdog() {
    this.stopWatchdog();
    this.watchdog = setInterval(() => {
      if (!this.receiver) return;
      const idle = Date.now() - this.lastAudioAt;
      if (idle > NDIReceiveService.STALL_MS && !this.stalled) {
        this.stalled = true;
        this.send("ndiAudio:error", { message: "NDI audio feed lost — check the streaming PC (OBS/DistroAV) and the network.", suggestion: "" });
      }
    }, 1000);
  }
  private stopWatchdog() {
    if (this.watchdog) { clearInterval(this.watchdog); this.watchdog = null; }
  }

  private ensureLoaded(): boolean {
    if (this.mod) return !!this.mod.NdiReceiver;
    const { mod, error } = loadNative();
    this.mod = mod;
    this.error = error;
    return !!(mod && mod.NdiReceiver);
  }

  private send(channel: string, payload: unknown) {
    try { this.getMainWindow()?.webContents.send(channel, payload); } catch { /* window gone */ }
  }

  getStatus(): NdiReceiveStatus {
    const threadUp = !!this.receiver && (() => { try { return this.receiver!.isConnected(); } catch { return false; } })();
    return {
      available: this.ensureLoaded(),
      // "connected" reflects a LIVE audio feed, not merely a running receiver
      // thread — so the UI's "receiving" indicator can't lie when the source drops.
      connected: threadUp && !this.stalled,
      sourceName: this.sourceName,
      error: this.error,
    };
  }

  listSources(): NdiSourceInfo[] {
    if (!this.ensureLoaded() || !this.mod?.NdiReceiver) return [];
    try {
      // When connected, the live receiver's finder is already alive — reuse it.
      if (this.receiver) return this.receiver.listSources();
      // Otherwise use ONE persistent discovery finder, created lazily and kept
      // alive across polls, so NDI's mDNS discovery has time to dwell and populate
      // (a throwaway instance per poll — the old behaviour — never discovered
      // anything because its finder was destroyed before it could see the network).
      if (!this.discovery) this.discovery = new this.mod.NdiReceiver();
      return this.discovery.listSources();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      return [];
    }
  }

  async start(sourceName: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.ensureLoaded() || !this.mod?.NdiReceiver) {
      return { ok: false, error: this.error || "NDI receiver addon unavailable" };
    }
    this.stop(); // idempotent — tear down any prior session
    try {
      const receiver = new this.mod.NdiReceiver();
      this.receiver = receiver;
      this.resampler = null; // (lazily created when we learn the source rate)
      this.lastAudioAt = Date.now(); // grace period before the stall watchdog trips
      this.stalled = false;
      // A fresh receiver's NDI finder has seen nothing yet: a source on ANOTHER PC
      // (OBS/DistroAV) takes ~1-3s of mDNS dwell to appear, so a single immediate
      // connect() failed with "not found" and the app silently fell back to the
      // laptop mic (same-PC Test Patterns resolve instantly, which hid this). Retry
      // on the SAME receiver (its finder keeps dwelling) until the source appears.
      const deadline = Date.now() + NDIReceiveService.CONNECT_WAIT_MS;
      let ok = false;
      let lastErr = "NDI source not found on the network";
      for (;;) {
        try {
          ok = receiver.connect(sourceName, (pcm, sampleRate, channels) => {
            this.onAudio(pcm, sampleRate, channels);
          });
        } catch (e) {
          lastErr = e instanceof Error ? e.message : String(e);
        }
        if (ok || Date.now() >= deadline) break;
        await new Promise((r) => setTimeout(r, 500));
        // stop()/another start() ran while we waited: this attempt is superseded.
        if (this.receiver !== receiver) {
          try { receiver.disconnect(); } catch { /* ignore */ }
          return { ok: false, error: "NDI connect superseded" };
        }
      }
      if (!ok) {
        this.stop();
        return { ok: false, error: lastErr };
      }
      this.lastAudioAt = Date.now(); // restart the stall grace period after the wait
      this.sourceName = sourceName;
      this.error = null;
      this.startWatchdog();
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.error = msg;
      this.stop();
      return { ok: false, error: msg };
    }
  }

  stop() {
    this.stopWatchdog();
    if (this.receiver) {
      try { this.receiver.disconnect(); } catch { /* ignore */ }
      this.receiver = null;
    }
    this.resampler = null;
    this.sourceName = null;
    this.stalled = false;
  }

  shutdown() {
    this.stop();
    // Tear down the persistent discovery finder only on full service teardown —
    // NOT in stop() (per-source), so deselecting a source keeps the list live.
    if (this.discovery) {
      try { this.discovery.disconnect(); } catch { /* ignore */ }
      this.discovery = null;
    }
  }

  // Called on the NDI capture thread (marshalled to the main thread by the addon
  // TSFN). `pcm` is interleaved int16 at `sampleRate` × `channels`.
  private onAudio(pcm: Buffer, sampleRate: number, channels: number) {
    if (!pcm || channels <= 0 || sampleRate <= 0) return;
    // Feed is alive — refresh the watchdog and clear a prior stall (source came back).
    this.lastAudioAt = Date.now();
    if (this.stalled) this.stalled = false;
    // int16 view over the buffer.
    const int16 = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
    const frames = Math.floor(int16.length / channels);
    if (frames <= 0) return;

    // Down-mix to mono float [-1,1].
    const mono = new Float32Array(frames);
    if (channels === 1) {
      for (let i = 0; i < frames; i++) mono[i] = int16[i] / 0x8000;
    } else {
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) sum += int16[i * channels + c];
        mono[i] = (sum / channels) / 0x8000;
      }
    }

    // Resample → 16 kHz (stateful across chunks so there are no boundary clicks).
    if (!this.resampler) this.resampler = new MonoResampler(sampleRate);
    const out = this.resampler.process(mono);
    if (out.length === 0) return;

    // Level meter over the resampled mono chunk (matches the native onLevel shape).
    let peak = 0, sumsq = 0;
    for (let i = 0; i < out.length; i++) {
      const v = out[i] / 0x8000;
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
      sumsq += v * v;
    }
    const rms = Math.sqrt(sumsq / out.length);
    const db = rms > 0 ? 20 * Math.log10(rms) : -100;

    // Forward PCM + level to the renderer (same channels as the native path uses,
    // but namespaced to ndiAudio). PCM as a transferable ArrayBuffer copy.
    const ab = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
    this.send("ndiAudio:pcm", ab);
    this.send("ndiAudio:level", { rms, db, peak });
  }
}
