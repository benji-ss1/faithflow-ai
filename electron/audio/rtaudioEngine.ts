// rtaudioEngine.ts — hardware I/O Phases B + C (docs/HARDWARE_IO_PLAN.md).
//
// 2026-09-17: this engine runs ONLY inside the isolated audio-driver utility
// process (rtaudioWorker.ts). Native driver code (RtAudio/ASIO/WASAPI, Blackmagic
// DeckLink) can crash — e.g. RtAudio's WASAPI teardown on exit — and a crash
// there must never close the operator app. The main process talks to it through
// the proxy in rtaudioCapture.ts.
//
// Phase B: native multichannel capture through RtAudio (npm `audify`, N-API
// prebuilt, ABI-stable across Electron). CoreAudio on macOS, WASAPI + ASIO on
// Windows. Fixes: Windows never reporting channel counts (ffmpeg dshow can't),
// interfaces stuck at 2ch (ASIO exposes every input), macOS ffmpeg-tier fuzzy
// name matching / shifting avfoundation indices.
// Phase C: Blackmagic Desktop Video embedded SDI/HDMI audio via the
// native/decklink-audio addon, sharing the same DSP + IPC path.
//
// Contract mirrors nativeCapture.ts + multiChannelProbe.ts EXACTLY (same IPC
// channels, 16 kHz mono s16le chunks, level payloads, ffmpeg-style `pan`
// channel filter) so the renderer needs no changes.
//
// Review-gate hardening (2026-09-16):
//  • start/stop are SERIALISED (concurrent starts leaked 2–3 live streams).
//  • every stream has a liveness flag — late driver frames are dropped.
//  • the DeckLink addon holds ONE input session: a second DeckLink open is
//    refused, and a stale wrapper can never stop someone else's session.
//  • capture auto-reconnects with backoff on stream errors (ffmpeg-tier parity).
//  • device lists are cached briefly and ASIO is not re-enumerated while an
//    ASIO stream is open (ASIO allows one loaded driver).
//  • unknown native error text is logged, never shown raw to operators.

import path from "node:path";
// Same channel names as nativeCapture.ts / multiChannelProbe.ts (inlined so the
// worker never loads Electron-main modules).
const CHANNELS = { pcmChunk: "audio:nativePcmChunk", level: "audio:nativeLevel", error: "audio:nativeError" } as const;
const PROBE_CHANNELS = { levels: "audio:nativeChannelLevels", error: "audio:nativeChannelError" } as const;
import type { NativeDevice } from "./deviceList";
import {
  parsePanFilter, mixToMono, StreamingResampler, channelLevels,
  encodeDeviceIndex, decodeDeviceIndex, API_DECKLINK, deckLinkChannels,
} from "./rtaudioDsp";

// const-enum values from audify/index.d.ts (const enums don't exist at runtime)
const API_CORE = 1;
const API_ASIO = 6;
const API_WASAPI = 7;
const FMT_SINT16 = 0x2;
const FRAME_MS = 20;
const LEVEL_INTERVAL_MS = 50;
const LIST_CACHE_MS = 1500;
const RESTART_BACKOFF_MS = [2000, 4000, 8000, 16000, 30000];

export const FRIENDLY_BUSY = "Could not open the audio device — it's in use by another app (OBS, a DAW, vMix, or the interface's own control panel). Close it and reselect the input.";
export const FRIENDLY_GONE = "Audio device disappeared — reconnect the USB cable and reselect the input.";
export const FRIENDLY_UNAVAILABLE = "The pro audio driver isn't available in this build — using standard capture.";
const FRIENDLY_GENERIC = "Couldn't start the audio interface. Check the cable, close other audio apps, and reselect the input.";

function friendly(raw: string): string {
  console.warn(`[rtaudio] native error: ${raw}`);
  if (/busy|in use|exclusive|already|unavailable/i.test(raw)) return FRIENDLY_BUSY;
  if (/not found|invalid device|no devices|disappeared/i.test(raw)) return FRIENDLY_GONE;
  return FRIENDLY_GENERIC;
}

// ── native module loading ────────────────────────────────────────────────
type AudifyDevice = { id: number; name: string; inputChannels: number; preferredSampleRate: number; sampleRates: number[] };
type RtAudioLike = {
  getDevices(): AudifyDevice[];
  openStream(out: null, input: { deviceId: number; nChannels: number; firstChannel: number }, format: number, sampleRate: number, frameSize: number, name: string, onInput: (b: Buffer) => void, onOutput: null, flags?: number, onError?: (type: number, msg: string) => void): number;
  start(): void;
  stop(): void;
  closeStream(): void;
  isStreamOpen(): boolean;
};
type AudifyModule = { RtAudio: new (api?: number) => RtAudioLike };

let audify: AudifyModule | null | undefined;

function loadAudify(): AudifyModule | null {
  if (audify !== undefined) return audify;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    audify = require("audify") as AudifyModule;
  } catch (err) {
    console.warn("[rtaudio] audify unavailable — tier disabled:", err instanceof Error ? err.message : err);
    audify = null;
  }
  return audify;
}

type DeckLinkDevice = { index: number; name: string; channelCount: number; sampleRate: number };
type DeckLinkModule = {
  isAvailable(): boolean;
  listDevices(): DeckLinkDevice[];
  start(index: number, channels: number, onPcm: (b: Buffer) => void): { ok: boolean; error?: string };
  stop(): void;
};
let decklink: DeckLinkModule | null | undefined;
function loadDeckLink(): DeckLinkModule | null {
  if (decklink !== undefined) return decklink;
  decklink = null;
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, "native", "decklink-audio") : null,
    path.join(__dirname, "..", "..", "native", "decklink-audio"),
  ].filter((p): p is string => !!p);
  for (const p of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(p) as DeckLinkModule | null;
      if (mod) { decklink = mod; break; }
    } catch { /* not built / not bundled — Blackmagic audio unavailable */ }
  }
  return decklink;
}

// Long-lived RtAudio instances. NEVER create-and-discard: RtAudio's WASAPI
// destructor can crash when V8 garbage-collects a dropped instance, and a native
// crash in the main process would close PresentFlow mid-service. One instance per
// (role, host API), created once and kept for the app's lifetime; streams are
// opened/closed on them.
type RtRole = "enum" | "capture" | "probe";
const rtPool = new Map<string, RtAudioLike>();
function pooledRtAudio(mod: AudifyModule, role: RtRole, api: number): RtAudioLike {
  const key = `${role}:${api}`;
  let rt = rtPool.get(key);
  if (!rt) {
    rt = new mod.RtAudio(api);
    rtPool.set(key, rt);
  }
  return rt;
}

function apisForPlatform(): number[] {
  if (process.platform === "darwin") return [API_CORE];
  // WASAPI first (every device); ASIO adds the full-channel driver view.
  if (process.platform === "win32") return [API_WASAPI, API_ASIO];
  return [];
}

// ── renderer target ──────────────────────────────────────────────────────
// Events flow out through a sink (the worker forwards them to the main process).
let sink: (channel: string, payload: unknown) => void = () => {};
export function setEngineSink(fn: (channel: string, payload: unknown) => void) {
  sink = fn;
}
function send(channel: string, payload: unknown) {
  try { sink(channel, payload); } catch { /* host gone */ }
}

// ── sessions ─────────────────────────────────────────────────────────────
type Session = { deviceIndex: number; api: number; close(): void };
let tokenCounter = 0;
let capture: Session | null = null;
let probe: Session | null = null;
let deckLinkOwner: number | null = null; // token of the session holding the addon

function isAsioOpen(): boolean {
  return capture?.api === API_ASIO || probe?.api === API_ASIO;
}

// Serialise every start/stop so concurrent IPC calls can't leak streams.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T> | T): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

// ── device lists ─────────────────────────────────────────────────────────
let rtCache: { at: number; list: NativeDevice[] } | null = null;

export function isRtAudioAvailable(): boolean {
  return loadAudify() !== null && apisForPlatform().length > 0;
}

export function listRtAudioDevices(): NativeDevice[] {
  const mod = loadAudify();
  if (!mod) return [];
  const now = Date.now();
  if (rtCache && now - rtCache.at < LIST_CACHE_MS) return rtCache.list;
  const out: NativeDevice[] = [];
  for (const api of apisForPlatform()) {
    if (api === API_ASIO && isAsioOpen()) {
      // Don't load a second ASIO driver instance under a live stream.
      out.push(...(rtCache?.list.filter((d) => decodeDeviceIndex(d.index).api === API_ASIO) ?? []));
      continue;
    }
    try {
      const rt = pooledRtAudio(mod, "enum", api);
      for (const d of rt.getDevices()) {
        if (!d.inputChannels) continue;
        out.push({
          index: encodeDeviceIndex(api, d.id),
          name: api === API_ASIO ? `${d.name} (ASIO)` : d.name,
          platform: process.platform as NativeDevice["platform"],
          channelCount: d.inputChannels,
          sampleRate: d.preferredSampleRate || undefined,
        });
      }
    } catch (err) {
      // ASIO with no driver installed throws — normal, not an error.
      console.log(`[rtaudio] api ${api} enumerate skipped:`, err instanceof Error ? err.message : err);
    }
  }
  rtCache = { at: now, list: out };
  return out;
}

/** Blackmagic devices with audio input. Empty when driver/addon absent. */
export function listDeckLinkAudioDevices(): NativeDevice[] {
  const mod = loadDeckLink();
  if (!mod) return [];
  try {
    if (!mod.isAvailable()) return [];
    return mod.listDevices().map((d) => ({
      index: encodeDeviceIndex(API_DECKLINK, d.index),
      name: `${d.name} (Blackmagic SDI/HDMI audio)`,
      platform: process.platform as NativeDevice["platform"],
      channelCount: deckLinkChannels(d.channelCount),
      sampleRate: 48000,
    }));
  } catch (err) {
    console.warn("[decklink] list failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

// ── opening inputs ───────────────────────────────────────────────────────
type FrameFn = (pcm: Int16Array, channels: number, sampleRate: number) => void;
type Opened = { ok: true; session: Session } | { ok: false; error: string };

function openInput(role: Exclude<RtRole, "enum">, deviceIndex: number, onFrame: FrameFn, onStreamError: (msg: string) => void): Opened {
  const { api, id } = decodeDeviceIndex(deviceIndex);
  if (api === API_DECKLINK) return openDeckLink(deviceIndex, id, onFrame);

  const mod = loadAudify();
  if (!mod) return { ok: false, error: FRIENDLY_UNAVAILABLE };
  if (!apisForPlatform().includes(api)) return { ok: false, error: FRIENDLY_GONE };
  try {
    const rt = pooledRtAudio(mod, role, api);
    try { if (rt.isStreamOpen()) { rt.stop(); rt.closeStream(); } } catch { /* already closed */ }
    const dev = rt.getDevices().find((d) => d.id === id);
    if (!dev || !dev.inputChannels) return { ok: false, error: FRIENDLY_GONE };
    const channels = Math.min(dev.inputChannels, 64);
    const sampleRate = dev.preferredSampleRate || (dev.sampleRates.includes(48000) ? 48000 : dev.sampleRates[0]);
    const frameSize = Math.max(64, Math.round((sampleRate * FRAME_MS) / 1000));
    let live = true;
    rt.openStream(
      null,
      { deviceId: id, nChannels: channels, firstChannel: 0 },
      FMT_SINT16,
      sampleRate,
      frameSize,
      "PresentFlow",
      (buf: Buffer) => {
        if (!live) return; // late frame from a closed/superseded stream
        const usable = buf.byteLength - (buf.byteLength % 2);
        onFrame(new Int16Array(buf.buffer, buf.byteOffset, usable / 2), channels, sampleRate);
      },
      null,
      0,
      // RtAudioErrorType 0/1 = (debug) warnings, e.g. close-time chatter — log only.
      (type, msg) => { if (type <= 1) console.log(`[rtaudio] ${msg}`); else if (live) onStreamError(msg); },
    );
    rt.start();
    return {
      ok: true,
      session: {
        deviceIndex, api,
        close() {
          live = false;
          try { rt.stop(); } catch { /* not running */ }
          try { if (rt.isStreamOpen()) rt.closeStream(); } catch { /* already closed */ }
        },
      },
    };
  } catch (err) {
    return { ok: false, error: friendly(err instanceof Error ? err.message : String(err)) };
  }
}

function openDeckLink(deviceIndex: number, id: number, onFrame: FrameFn): Opened {
  const mod = loadDeckLink();
  if (!mod) return { ok: false, error: "Blackmagic audio isn't included in this build of PresentFlow." };
  if (deckLinkOwner !== null) {
    return { ok: false, error: "A Blackmagic input is already in use by PresentFlow. Stop listening (or close the channel meters) first." };
  }
  const dev = listDeckLinkAudioDevices().find((d) => d.index === deviceIndex);
  if (!dev) return { ok: false, error: "Blackmagic device not found — install Desktop Video 14.3+, allow its extensions, and reconnect the device." };
  const channels = deckLinkChannels(dev.channelCount);
  let live = true;
  const res = mod.start(id, channels, (buf) => {
    if (!live) return;
    const usable = buf.byteLength - (buf.byteLength % 2);
    onFrame(new Int16Array(buf.buffer, buf.byteOffset, usable / 2), channels, 48000);
  });
  if (!res.ok) return { ok: false, error: res.error ?? FRIENDLY_GENERIC };
  const token = ++tokenCounter;
  deckLinkOwner = token;
  return {
    ok: true,
    session: {
      deviceIndex, api: API_DECKLINK,
      close() {
        live = false;
        if (deckLinkOwner === token) { // never stop another session's input
          deckLinkOwner = null;
          try { mod.stop(); } catch { /* already stopped */ }
        }
      },
    },
  };
}

// ── capture ──────────────────────────────────────────────────────────────
type CaptureWant = { deviceIndex: number; channelFilter?: string; name?: string };
let want: CaptureWant | null = null; // what the operator asked for (null = stopped)
let restartTimer: NodeJS.Timeout | null = null;
let restartAttempts = 0;

function clearRestart() {
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
}

function openCapture(w: CaptureWant): Opened {
  const terms = parsePanFilter(w.channelFilter);
  if (w.channelFilter && !terms) {
    console.warn(`[rtaudio] channel filter not understood, using all channels: ${w.channelFilter}`);
  }
  let resampler: StreamingResampler | null = null;
  let lastLevel = 0;
  return openInput(
    "capture",
    w.deviceIndex,
    (pcm, channels, sampleRate) => {
      if (!resampler || resampler.inRate !== sampleRate) resampler = new StreamingResampler(sampleRate, 16000);
      const out = resampler.process(mixToMono(pcm, channels, terms));
      if (!out.length) return;
      if (restartAttempts > 0) restartAttempts = 0; // healthy audio heals backoff
      send(CHANNELS.pcmChunk, out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength));
      const now = Date.now();
      if (now - lastLevel >= LEVEL_INTERVAL_MS) {
        lastLevel = now;
        const [lv] = channelLevels(out, 1);
        send(CHANNELS.level, { rms: lv.rms, db: lv.db, peak: lv.peak });
      }
    },
    (msg) => {
      console.warn(`[rtaudio] capture stream error: ${msg}`);
      void serial(() => scheduleReconnect(w));
    },
  );
}

function scheduleReconnect(w: CaptureWant) {
  if (want !== w || restartTimer) return; // superseded, or already scheduled
  capture?.close();
  capture = null;
  if (restartAttempts >= RESTART_BACKOFF_MS.length) {
    send(CHANNELS.error, {
      message: "The audio interface stopped responding and PresentFlow stopped retrying.",
      suggestion: "Check the USB cable and power, then reselect the input.",
    });
    return;
  }
  const delay = RESTART_BACKOFF_MS[restartAttempts++];
  send(CHANNELS.error, { message: "Audio interface disconnected — reconnecting…", suggestion: "Check the USB cable." });
  restartTimer = setTimeout(() => {
    restartTimer = null;
    void serial(() => {
      if (want !== w || capture) return;
      // Re-resolve by NAME: a replug can change RtAudio's device ids.
      rtCache = null;
      const byName = w.name
        ? [...listRtAudioDevices(), ...listDeckLinkAudioDevices()].find((d) => d.name === w.name)
        : undefined;
      const res = openCapture({ ...w, deviceIndex: byName?.index ?? w.deviceIndex });
      if (res.ok) {
        capture = res.session;
        console.log("[rtaudio] capture reconnected");
      } else {
        scheduleReconnect(w);
      }
    });
  }, delay);
}

export function startRtAudioCapture(opts: { deviceIndex: number; channelFilter?: string }): Promise<{ ok: boolean; error?: string }> {
  return serial(() => {
    clearRestart();
    restartAttempts = 0;
    capture?.close();
    capture = null;
    want = null;
    const isDeckLink = decodeDeviceIndex(opts.deviceIndex).api === API_DECKLINK;
    const { api } = decodeDeviceIndex(opts.deviceIndex);
    if (probe && (probe.api === API_DECKLINK || probe.api === API_ASIO) && probe.api === api) {
      probe.close(); // single-stream driver (DeckLink / ASIO) — live capture wins over meters
      probe = null;
    }
    const name = (isDeckLink ? listDeckLinkAudioDevices() : listRtAudioDevices())
      .find((d) => d.index === opts.deviceIndex)?.name;
    const w: CaptureWant = { ...opts, name };
    const res = openCapture(w);
    if (!res.ok) return { ok: false, error: res.error };
    want = w;
    capture = res.session;
    return { ok: true };
  });
}

export function stopRtAudioCapture(): Promise<void> {
  return serial(() => {
    clearRestart();
    want = null;
    capture?.close();
    capture = null;
  });
}

// ── probe (per-channel meters) ───────────────────────────────────────────
export function startRtAudioProbe(opts: { deviceIndex: number }): Promise<{ ok: boolean; error?: string }> {
  return serial(() => {
    probe?.close();
    probe = null;
    const { api } = decodeDeviceIndex(opts.deviceIndex);
    if (api === API_DECKLINK && capture?.api === API_DECKLINK) {
      return { ok: false, error: "Channel meters for Blackmagic inputs are available when listening is stopped." };
    }
    if (api === API_ASIO && capture?.api === API_ASIO) {
      return { ok: false, error: "ASIO allows one stream at a time — stop listening to see per-channel meters." };
    }
    let window: Int16Array[] = [];
    let lastEmit = Date.now();
    const res = openInput(
      "probe",
      opts.deviceIndex,
      (pcm, channels) => {
        window.push(Int16Array.from(pcm));
        const now = Date.now();
        if (now - lastEmit < LEVEL_INTERVAL_MS) return;
        lastEmit = now;
        const total = window.reduce((n, a) => n + a.length, 0);
        const joined = new Int16Array(total);
        let o = 0;
        for (const a of window) { joined.set(a, o); o += a.length; }
        window = [];
        send(PROBE_CHANNELS.levels, channelLevels(joined, channels));
      },
      () => send(PROBE_CHANNELS.error, { message: FRIENDLY_GONE }),
    );
    if (!res.ok) return { ok: false, error: res.error };
    probe = res.session;
    return { ok: true };
  });
}

export function stopRtAudioProbe(): Promise<void> {
  return serial(() => {
    probe?.close();
    probe = null;
  });
}

export function isRtAudioCapturing(): boolean {
  return capture !== null;
}
