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
/** Transient: the driver process is (re)starting. Never a reason to downgrade the tier. */
export const FRIENDLY_RESTARTING = "The audio driver is restarting — try again in a moment.";

const CALL_TIMEOUT_MS = 15000;
const START_TIMEOUT_MS = 35000; // ASIO / DeckLink / aggregate opens can be slow
const START_READY_MS = 15000;
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
const intentionalExit = new WeakSet<UtilityProcess>();
let ready: Promise<void> | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
let crashTimes: number[] = [];
let disabled = false;
// What capture should be running, so a worker crash can resume it.
let wantCapture: { deviceIndex: number; channelFilter?: string } | null = null;
let capturing = false;

function workerPath(): string {
  return path.join(__dirname, "rtaudioWorker.js");
}

function killWorker(proc: UtilityProcess | null) {
  if (!proc) return;
  intentionalExit.add(proc);
  try { proc.kill(); } catch { /* already gone */ }
  if (child === proc) { child = null; ready = null; }
}

function ensureWorker(): Promise<void> {
  if (disabled) return Promise.reject(new Error(FRIENDLY_UNAVAILABLE));
  if (child && ready) return ready;
  const proc = utilityProcess.fork(workerPath(), [], {
    serviceName: "PresentFlow Audio Driver",
    stdio: "inherit",
    // The worker locates the Blackmagic addon (shipped via extraResources) here.
    env: { ...process.env, PF_RESOURCES_PATH: process.resourcesPath ?? "" },
  });
  child = proc;
  let settleReady: ((err?: Error) => void) | null = null;
  ready = new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => settleReady?.(new Error("audio driver process did not start")), START_READY_MS);
    settleReady = (err) => {
      clearTimeout(t);
      settleReady = null;
      if (err) {
        // Never leave a half-started worker cached: kill + clear so the next call retries.
        killWorker(proc);
        reject(err);
      } else {
        resolve();
      }
    };
    proc.on("message", (msg: { id?: number; ok?: boolean; result?: unknown; error?: string; event?: string; payload?: unknown }) => {
      if (msg?.event === "__ready") { settleReady?.(); return; }
      if (msg?.event) {
        // Drop late PCM/levels from a capture the proxy no longer owns.
        if (!capturing && (msg.event === "audio:nativePcmChunk" || msg.event === "audio:nativeLevel")) return;
        toWindow(msg.event, msg.payload);
        return;
      }
      if (typeof msg?.id === "number") {
        const p = pending.get(msg.id);
        if (!p) return; // late reply after a timeout — ignored
        pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new Error(msg.error ?? "audio driver error"));
      }
    });
  });
  proc.on("exit", (code) => {
    settleReady?.(new Error("audio driver process exited during start"));
    if (child !== proc && !intentionalExit.has(proc)) return;
    if (child === proc) { child = null; ready = null; }
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
        void call<{ ok: boolean; error?: string }>("startCapture", resume, START_TIMEOUT_MS)
          .then((r) => {
            if (wantCapture !== resume) {
              // Operator stopped/switched while the resume was in flight — undo it.
              if (r?.ok) void call("stopCapture").catch(() => {});
              return;
            }
            capturing = !!r?.ok;
            if (!r?.ok) toWindow("audio:nativeError", { message: r?.error ?? FRIENDLY_GONE });
          })
          .catch(() => { /* next exit handler decides */ });
      }, 1000);
    }
  });
  return ready;
}

async function call<T>(op: string, args?: unknown, timeoutMs = CALL_TIMEOUT_MS): Promise<T> {
  await ensureWorker();
  const proc = child;
  if (!proc) throw new Error("audio driver process unavailable");
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("audio driver did not respond"));
    }, timeoutMs);
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
    proc.postMessage({ id, op, args });
  });
}

/** Operator re-enabled the pro driver: give the driver process a clean slate. */
export function resetRtAudioWorkerHealth(): void {
  disabled = false;
  crashTimes = [];
  availableCache = null;
}

let availableCache: { at: number; value: boolean } | null = null;
export async function isRtAudioAvailable(): Promise<boolean> {
  if (disabled) return false;
  if (availableCache && Date.now() - availableCache.at < 60_000) return availableCache.value;
  let value = false;
  try { value = !!(await call<boolean>("isAvailable")); } catch { value = false; }
  availableCache = { at: Date.now(), value };
  return value;
}

export async function listRtAudioDevices(): Promise<NativeDevice[]> {
  try { return (await call<NativeDevice[]>("listDevices")) ?? []; } catch { return []; }
}

export async function listDeckLinkAudioDevices(): Promise<NativeDevice[]> {
  try { return (await call<NativeDevice[]>("listDeckLink")) ?? []; } catch { return []; }
}

export async function startRtAudioCapture(opts: { deviceIndex: number; channelFilter?: string }): Promise<{ ok: boolean; error?: string }> {
  const want = { deviceIndex: opts.deviceIndex, channelFilter: opts.channelFilter };
  wantCapture = want;
  capturing = false;
  try {
    const r = await call<{ ok: boolean; error?: string }>("startCapture", want, START_TIMEOUT_MS);
    if (wantCapture !== want) {
      // Superseded while opening — make sure the worker isn't left streaming it.
      if (r?.ok) void call("stopCapture").catch(() => {});
      return { ok: false, error: FRIENDLY_RESTARTING };
    }
    capturing = !!r?.ok;
    if (!r?.ok) wantCapture = null;
    return r ?? { ok: false, error: FRIENDLY_RESTARTING };
  } catch {
    // Timed out or the worker died mid-open. The worker may still finish the open
    // and stream — kill it so there can never be two captures feeding the AI.
    if (wantCapture === want) wantCapture = null;
    capturing = false;
    killWorker(child);
    return { ok: false, error: disabled ? FRIENDLY_UNAVAILABLE : FRIENDLY_RESTARTING };
  }
}

async function stopWithDeadline(op: string): Promise<void> {
  if (!child) return;
  try { await call(op, undefined, 2000); } catch { killWorker(child); }
}

export async function stopRtAudioCapture(): Promise<void> {
  wantCapture = null;
  capturing = false;
  await stopWithDeadline("stopCapture");
}

export async function startRtAudioProbe(opts: { deviceIndex: number }): Promise<{ ok: boolean; error?: string }> {
  try {
    return (await call<{ ok: boolean; error?: string }>("startProbe", opts, START_TIMEOUT_MS)) ?? { ok: false, error: FRIENDLY_RESTARTING };
  } catch {
    return { ok: false, error: disabled ? FRIENDLY_UNAVAILABLE : FRIENDLY_RESTARTING };
  }
}

export async function stopRtAudioProbe(): Promise<void> {
  await stopWithDeadline("stopProbe");
}

export function isRtAudioCapturing(): boolean {
  return capturing;
}

/** Window closed / app quit: stop the worker without treating its exit as a crash.
 *  A later audio call simply starts a fresh worker. */
export function shutdownRtAudioWorker(): void {
  wantCapture = null;
  capturing = false;
  killWorker(child);
}
