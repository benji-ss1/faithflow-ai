// rtaudioCapture.ts — main-process PROXY for the isolated audio-driver process.
//
// All native audio-driver code (RtAudio: CoreAudio/WASAPI/ASIO, and the
// Blackmagic DeckLink addon) runs in a separate Electron utility process
// (rtaudioWorker.ts → rtaudioEngine.ts). A native crash there — during capture
// or at exit — can never close PresentFlow. This proxy:
//   • forks the worker lazily and forwards its PCM/level/error events to the
//     operator window on the same IPC channels as the ffmpeg/Swift tiers;
//   • on an unexpected worker exit: tells the operator, restarts the worker and
//     resumes the capture that was running (bounded; after repeated crashes the
//     pro driver is reported unavailable and standard capture takes over);
//   • keeps the same export names the IPC layer already used.

import path from "node:path";
import { utilityProcess, type UtilityProcess, type BrowserWindow } from "electron";
import type { NativeDevice } from "./deviceList";

export const FRIENDLY_BUSY = "Could not open the audio device — it's in use by another app (OBS, a DAW, vMix, or the interface's own control panel). Close it and reselect the input.";
export const FRIENDLY_GONE = "Audio device disappeared — reconnect the USB cable and reselect the input.";
export const FRIENDLY_UNAVAILABLE = "The pro audio driver isn't available in this build — using standard capture.";

const CALL_TIMEOUT_MS = 15000;
const MAX_CRASHES = 3;
const CRASH_WINDOW_MS = 10 * 60 * 1000;

let getTargetWindow: () => BrowserWindow | null = () => null;
export function setRtAudioTarget(getter: () => BrowserWindow | null) {
  getTargetWindow = getter;
}
function toWindow(channel: string, payload: unknown) {
  const win = getTargetWindow();
  if (!win || win.isDestroyed()) return;
  try { win.webContents.send(channel, payload); } catch { /* window tearing down */ }
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };
let child: UtilityProcess | null = null;
let ready: Promise<void> | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
let crashTimes: number[] = [];
let disabled = false;
// Workers we stopped on purpose (window closed / app quit) — their exit is not a crash.
const intentionalExit = new WeakSet<UtilityProcess>();
// What capture should be running, so a worker crash can resume it.
let wantCapture: { deviceIndex: number; channelFilter?: string } | null = null;
let capturing = false;

function workerPath(): string {
  return path.join(__dirname, "rtaudioWorker.js");
}

function ensureWorker(): Promise<void> {
  if (disabled) return Promise.reject(new Error(FRIENDLY_UNAVAILABLE));
  if (child && ready) return ready;
  const proc = utilityProcess.fork(workerPath(), [], {
    serviceName: "PresentFlow Audio Driver",
    stdio: "inherit",
  });
  child = proc;
  ready = new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("audio driver process did not start")), CALL_TIMEOUT_MS);
    proc.on("message", (msg: { id?: number; ok?: boolean; result?: unknown; error?: string; event?: string; payload?: unknown }) => {
      if (msg?.event === "__ready") { clearTimeout(t); resolve(); return; }
      if (msg?.event) { toWindow(msg.event, msg.payload); return; }
      if (typeof msg?.id === "number") {
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new Error(msg.error ?? "audio driver error"));
      }
    });
  });
  proc.on("exit", (code) => {
    if (child !== proc) return;
    child = null;
    ready = null;
    for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new Error("audio driver process exited")); }
    pending.clear();
    const wasCapturing = capturing;
    capturing = false;
    if (intentionalExit.has(proc)) return;
    console.warn(`[rtaudio] audio driver process exited (code=${code})`);
    const now = Date.now();
    crashTimes = [...crashTimes.filter((t) => now - t < CRASH_WINDOW_MS), now];
    if (crashTimes.length >= MAX_CRASHES) {
      disabled = true;
      console.warn("[rtaudio] audio driver process crashed repeatedly — pro driver disabled for this session");
      if (wasCapturing) {
        toWindow("audio:nativeError", {
          message: "The pro audio driver stopped working on this computer.",
          suggestion: "Turn off Pro audio driver in Audio settings, or restart PresentFlow.",
        });
      }
      return;
    }
    if (wasCapturing && wantCapture) {
      const resume = wantCapture;
      toWindow("audio:nativeError", { message: "Audio driver restarted — reconnecting…", suggestion: "No action needed." });
      setTimeout(() => {
        if (wantCapture !== resume) return; // operator changed/stopped meanwhile
        void call<{ ok: boolean; error?: string }>("startCapture", resume)
          .then((r) => { capturing = !!r?.ok; if (!r?.ok) toWindow("audio:nativeError", { message: r?.error ?? FRIENDLY_GONE }); })
          .catch(() => { /* next exit handler decides */ });
      }, 1000);
    }
  });
  return ready;
}

async function call<T>(op: string, args?: unknown): Promise<T> {
  await ensureWorker();
  const proc = child;
  if (!proc) throw new Error("audio driver process unavailable");
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("audio driver did not respond"));
    }, CALL_TIMEOUT_MS);
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
    proc.postMessage({ id, op, args });
  });
}

export async function isRtAudioAvailable(): Promise<boolean> {
  try { return !!(await call<boolean>("isAvailable")); } catch { return false; }
}

export async function listRtAudioDevices(): Promise<NativeDevice[]> {
  try { return (await call<NativeDevice[]>("listDevices")) ?? []; } catch { return []; }
}

export async function listDeckLinkAudioDevices(): Promise<NativeDevice[]> {
  try { return (await call<NativeDevice[]>("listDeckLink")) ?? []; } catch { return []; }
}

export async function startRtAudioCapture(opts: { deviceIndex: number; channelFilter?: string }): Promise<{ ok: boolean; error?: string }> {
  wantCapture = { deviceIndex: opts.deviceIndex, channelFilter: opts.channelFilter };
  try {
    const r = await call<{ ok: boolean; error?: string }>("startCapture", wantCapture);
    capturing = !!r?.ok;
    if (!r?.ok) wantCapture = null;
    return r ?? { ok: false, error: FRIENDLY_UNAVAILABLE };
  } catch {
    wantCapture = null;
    capturing = false;
    return { ok: false, error: FRIENDLY_UNAVAILABLE };
  }
}

export async function stopRtAudioCapture(): Promise<void> {
  wantCapture = null;
  capturing = false;
  if (!child) return;
  try { await call("stopCapture"); } catch { /* worker gone = stopped */ }
}

export async function startRtAudioProbe(opts: { deviceIndex: number }): Promise<{ ok: boolean; error?: string }> {
  try {
    return (await call<{ ok: boolean; error?: string }>("startProbe", opts)) ?? { ok: false, error: FRIENDLY_UNAVAILABLE };
  } catch {
    return { ok: false, error: FRIENDLY_UNAVAILABLE };
  }
}

export async function stopRtAudioProbe(): Promise<void> {
  if (!child) return;
  try { await call("stopProbe"); } catch { /* worker gone = stopped */ }
}

export function isRtAudioCapturing(): boolean {
  return capturing;
}

/** Window closed / app quit: stop the worker without treating its exit as a crash.
 *  A later audio call simply starts a fresh worker. */
export function shutdownRtAudioWorker(): void {
  wantCapture = null;
  capturing = false;
  if (child) intentionalExit.add(child);
  try { child?.kill(); } catch { /* already gone */ }
  child = null;
  ready = null;
}
