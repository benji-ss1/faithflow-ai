// nativeCapture.ts — spawns ffmpeg as a subprocess of the main process,
// captures PCM from a specified CoreAudio/DirectShow device + optional
// channel filter, and forwards audio + level meters to the main window
// via IPC. This is the fix for Chromium's silent 32-channel USB capture
// (JPD field failure). ffmpeg uses CoreAudio directly, matching OBS/Logic.
//
// Contract: one active capture at a time. Second startCapture stops the
// first. Auto-restart on unexpected close with exponential backoff, UNLESS
// stopCapture() was called explicitly (user intent trumps recovery).

import { spawn, ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { BrowserWindow } from "electron";
import { getFfmpegPath } from "./ffmpegPath";
import { computeLevel } from "./pcmLevel";
import { listNativeDevices } from "./deviceList";

export type StartCaptureOpts = {
  deviceIndex: number;
  channelFilter?: string;
  sampleRate?: number; // default 16000 (Deepgram)
  channels?: number;   // default 1 (mono for Deepgram)
};

type CaptureState = {
  proc: ChildProcessByStdio<null, Readable, Readable>;
  opts: StartCaptureOpts;
  deviceLabel: string; // for error messages
  restartAttempts: number;
  intentionalStop: boolean;
  restartTimer: NodeJS.Timeout | null;
  lastLevelSentAt: number;
};

let current: CaptureState | null = null;
// Broadcast target. Set by registerNativeAudioIpc so we don't create a
// hard import cycle with main.ts.
let getTargetWindow: () => BrowserWindow | null = () => null;

// Channels this module owns end-to-end. Kept in one place so main.ts and
// preload.ts can be audited against the same list.
export const CHANNELS = Object.freeze({
  pcmChunk: "audio:nativePcmChunk",
  level: "audio:nativeLevel",
  error: "audio:nativeError",
});

// Level emit throttle — ~20Hz. The renderer VU meter can't animate faster.
const LEVEL_INTERVAL_MS = 50;

// Exponential backoff schedule for auto-restart on unexpected exit.
const RESTART_BACKOFF_MS = [2000, 4000, 8000, 16000, 30000];

export function setCaptureTarget(getter: () => BrowserWindow | null) {
  getTargetWindow = getter;
}

function send(channel: string, payload: unknown) {
  const win = getTargetWindow();
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.send(channel, payload);
  } catch {
    /* silent — window may be tearing down */
  }
}

function classifyStderr(line: string): { message: string; suggestion?: string } | null {
  const lower = line.toLowerCase();
  if (lower.includes("input/output error") || lower.includes("device or resource busy")) {
    return {
      message: "Could not open audio device — it may be in use by another application (OBS, Logic, etc.).",
      suggestion: "Close other audio apps and reselect the device.",
    };
  }
  if (lower.includes("device not found") || lower.includes("cannot find audio device")) {
    return {
      message: "Audio device disappeared — replug USB or reselect the input.",
      suggestion: "Reconnect the USB cable, then choose the device again from the list.",
    };
  }
  if (lower.includes("permission denied") || lower.includes("not authorized")) {
    return {
      message: "PresentFlow does not have permission to access the microphone.",
      suggestion: "Open System Settings → Privacy & Security → Microphone and enable PresentFlow.",
    };
  }
  if (lower.includes("no such file or directory")) {
    return {
      message: "ffmpeg binary not found. The desktop install may be corrupt.",
      suggestion: "Reinstall PresentFlow.",
    };
  }
  return null;
}

function buildFfmpegArgs(opts: StartCaptureOpts, deviceName: string): string[] {
  const sr = opts.sampleRate ?? 16000;
  const ch = opts.channels ?? 1;
  const common = [
    ...(opts.channelFilter ? ["-af", opts.channelFilter] : []),
    "-ac", String(ch),
    "-ar", String(sr),
    "-f", "s16le",
    "-acodec", "pcm_s16le",
    "-loglevel", "warning",
    "pipe:1",
  ];
  if (process.platform === "darwin") {
    return [
      "-hide_banner",
      "-nostdin",
      "-f", "avfoundation",
      "-i", `:${opts.deviceIndex}`,
      ...common,
    ];
  }
  if (process.platform === "win32") {
    // dshow uses the device name string as the identifier — deviceIndex is
    // an internal-only stable id we assigned during enumeration.
    return [
      "-hide_banner",
      "-nostdin",
      "-f", "dshow",
      "-i", `audio=${deviceName}`,
      ...common,
    ];
  }
  // Linux: reject at start time so we don't spawn something misconfigured.
  throw new Error(`Native audio capture not supported on platform: ${process.platform}`);
}

async function resolveDeviceLabel(deviceIndex: number): Promise<string> {
  // For dshow we need the friendly device name to build the -i flag. On
  // avfoundation we still resolve the name for logging / error messages.
  try {
    const devices = await listNativeDevices();
    const match = devices.find((d) => d.index === deviceIndex);
    return match?.name ?? `#${deviceIndex}`;
  } catch {
    return `#${deviceIndex}`;
  }
}

async function spawnCapture(opts: StartCaptureOpts): Promise<CaptureState> {
  const label = await resolveDeviceLabel(opts.deviceIndex);
  const ffmpeg = getFfmpegPath();
  const args = buildFfmpegArgs(opts, label);
  const proc = spawn(ffmpeg, args, { stdio: ["ignore", "pipe", "pipe"] });
  const state: CaptureState = {
    proc,
    opts,
    deviceLabel: label,
    restartAttempts: 0,
    intentionalStop: false,
    restartTimer: null,
    lastLevelSentAt: 0,
  };

  proc.stdout.on("data", (chunk: Buffer) => {
    // Forward raw PCM to renderer. structuredClone-compatible: we build an
    // ArrayBuffer copy sliced to the exact byte range (Node Buffer views
    // share the underlying pool, sending it as-is would leak neighbor data).
    const ab = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer;
    send(CHANNELS.pcmChunk, ab);
    // Throttled level meter.
    const now = Date.now();
    if (now - state.lastLevelSentAt >= LEVEL_INTERVAL_MS) {
      state.lastLevelSentAt = now;
      const level = computeLevel(chunk);
      send(CHANNELS.level, level);
    }
    // A successful data delivery resets the restart backoff — we're
    // clearly capturing real audio, so any prior transient counts as healed.
    if (state.restartAttempts > 0) state.restartAttempts = 0;
  });

  proc.stderr.on("data", (buf: Buffer) => {
    const text = buf.toString("utf8");
    // ffmpeg emits multi-line messages; classify each line.
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const cls = classifyStderr(trimmed);
      if (cls) send(CHANNELS.error, cls);
      // Always log to main-process console for post-mortem.
      console.warn(`[nativeCapture:${state.deviceLabel}] ${trimmed}`);
    }
  });

  proc.on("error", (err) => {
    console.error(`[nativeCapture] spawn error:`, err);
    send(CHANNELS.error, { message: `ffmpeg failed to start: ${err.message}` });
  });

  proc.on("close", (code, signal) => {
    console.log(`[nativeCapture] ffmpeg exited (code=${code}, signal=${signal}, intentional=${state.intentionalStop})`);
    if (state.intentionalStop) return;
    // Unexpected exit — try to recover unless this state has been replaced.
    if (current !== state) return;
    scheduleRestart(state);
  });

  return state;
}

function scheduleRestart(state: CaptureState) {
  const attempt = state.restartAttempts;
  if (attempt >= RESTART_BACKOFF_MS.length) {
    send(CHANNELS.error, {
      message: `Audio capture from "${state.deviceLabel}" has failed repeatedly and stopped auto-restarting.`,
      suggestion: "Check the device connection and reselect the input.",
    });
    current = null;
    return;
  }
  const delay = RESTART_BACKOFF_MS[attempt];
  state.restartAttempts = attempt + 1;
  console.log(`[nativeCapture] restarting in ${delay}ms (attempt ${attempt + 1})`);
  state.restartTimer = setTimeout(() => {
    // Guard: another startCapture may have superseded us during the wait.
    if (current !== state) return;
    void (async () => {
      try {
        const fresh = await spawnCapture(state.opts);
        // Preserve the incremented restartAttempts so repeated failures
        // continue to back off rather than reset every time.
        fresh.restartAttempts = state.restartAttempts;
        current = fresh;
      } catch (err) {
        console.error(`[nativeCapture] restart spawn failed`, err);
        send(CHANNELS.error, {
          message: `Auto-restart failed: ${err instanceof Error ? err.message : String(err)}`,
        });
        scheduleRestart(state);
      }
    })();
  }, delay);
}

export async function startCapture(opts: StartCaptureOpts): Promise<{ ok: boolean; error?: string }> {
  if (process.platform !== "darwin" && process.platform !== "win32") {
    return { ok: false, error: `platform ${process.platform} not supported` };
  }
  await stopCapture();
  try {
    const state = await spawnCapture(opts);
    current = state;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function stopCapture(): Promise<void> {
  const state = current;
  if (!state) return;
  current = null;
  state.intentionalStop = true;
  if (state.restartTimer) {
    clearTimeout(state.restartTimer);
    state.restartTimer = null;
  }
  try {
    state.proc.kill("SIGTERM");
  } catch { /* noop */ }
  // Escalate to SIGKILL if ffmpeg hasn't exited within 1s. This is a safety
  // net for a ffmpeg build that swallows SIGTERM under an unusual codec pipe.
  await new Promise<void>((resolve) => {
    let settled = false;
    const to = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { state.proc.kill("SIGKILL"); } catch { /* noop */ }
      resolve();
    }, 1000);
    state.proc.once("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(to);
      resolve();
    });
  });
}

export function isCapturing(): boolean {
  return current !== null;
}
