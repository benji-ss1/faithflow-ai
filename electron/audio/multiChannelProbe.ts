// multiChannelProbe.ts — captures ALL channels of a multi-channel device
// interleaved at low sample rate (8kHz) with ONE ffmpeg process, splits
// the buffer in JS, and emits per-channel levels ~20Hz. This powers the
// channel-grid picker UI so a 32-channel mixer can render 32 live meters
// without spawning 32 subprocesses.

import { spawn, ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { BrowserWindow } from "electron";
import { getFfmpegPath } from "./ffmpegPath";
import { splitInterleaved } from "./pcmLevel";
import { listNativeDevices } from "./deviceList";

export type StartProbeOpts = {
  deviceIndex: number;
  channelCount: number;
};

type ProbeState = {
  proc: ChildProcessByStdio<null, Readable, Readable>;
  opts: StartProbeOpts;
  intentionalStop: boolean;
  lastEmitAt: number;
  buffered: Buffer[]; // accumulator for a 50ms window
  bufferedBytes: number;
};

let current: ProbeState | null = null;
let getTargetWindow: () => BrowserWindow | null = () => null;

export const PROBE_CHANNELS = Object.freeze({
  levels: "audio:nativeChannelLevels",
  error: "audio:nativeChannelError",
});

const EMIT_INTERVAL_MS = 50;
// 8kHz × 2 bytes/sample × N channels × 0.05s = ~800*N bytes/window.
// We flush based on time, not size, so a laggy chunk doesn't skew meters.

export function setProbeTarget(getter: () => BrowserWindow | null) {
  getTargetWindow = getter;
}

function send(channel: string, payload: unknown) {
  const win = getTargetWindow();
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.send(channel, payload);
  } catch { /* noop */ }
}

function buildArgs(opts: StartProbeOpts, deviceName: string): string[] {
  const common = [
    "-ac", String(opts.channelCount), // PRESERVE all channels, no downmix
    "-ar", "8000",                    // 8kHz is enough for RMS/vocal-band
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
    return [
      "-hide_banner",
      "-nostdin",
      "-f", "dshow",
      "-i", `audio=${deviceName}`,
      ...common,
    ];
  }
  throw new Error(`Multi-channel probe not supported on platform: ${process.platform}`);
}

async function resolveLabel(idx: number): Promise<string> {
  try {
    const devs = await listNativeDevices();
    return devs.find((d) => d.index === idx)?.name ?? `#${idx}`;
  } catch {
    return `#${idx}`;
  }
}

function flushLevels(state: ProbeState) {
  if (state.bufferedBytes === 0) return;
  // Concatenate the accumulated window and split into per-channel levels.
  const buf = Buffer.concat(state.buffered, state.bufferedBytes);
  state.buffered = [];
  state.bufferedBytes = 0;
  const levels = splitInterleaved(buf, state.opts.channelCount);
  const payload = levels.map((l, i) => ({ channel: i, rms: l.rms, db: l.db, peak: l.peak }));
  send(PROBE_CHANNELS.levels, payload);
}

export async function startChannelProbe(opts: StartProbeOpts): Promise<{ ok: boolean; error?: string }> {
  if (process.platform !== "darwin" && process.platform !== "win32") {
    return { ok: false, error: `platform ${process.platform} not supported` };
  }
  if (!Number.isInteger(opts.channelCount) || opts.channelCount < 1 || opts.channelCount > 64) {
    return { ok: false, error: `invalid channelCount ${opts.channelCount}` };
  }
  await stopChannelProbe();
  try {
    const label = await resolveLabel(opts.deviceIndex);
    const args = buildArgs(opts, label);
    const proc = spawn(getFfmpegPath(), args, { stdio: ["ignore", "pipe", "pipe"] });
    const state: ProbeState = {
      proc,
      opts,
      intentionalStop: false,
      lastEmitAt: 0,
      buffered: [],
      bufferedBytes: 0,
    };
    proc.stdout.on("data", (chunk: Buffer) => {
      state.buffered.push(chunk);
      state.bufferedBytes += chunk.length;
      const now = Date.now();
      if (now - state.lastEmitAt >= EMIT_INTERVAL_MS) {
        state.lastEmitAt = now;
        flushLevels(state);
      }
    });
    proc.stderr.on("data", (buf: Buffer) => {
      const text = buf.toString("utf8").trim();
      if (!text) return;
      console.warn(`[channelProbe:${label}] ${text}`);
    });
    proc.on("error", (err) => {
      console.error(`[channelProbe] spawn error`, err);
      send(PROBE_CHANNELS.error, { message: `Channel probe failed to start: ${err.message}` });
    });
    proc.on("close", (code, signal) => {
      console.log(`[channelProbe] ffmpeg exited (code=${code}, signal=${signal}, intentional=${state.intentionalStop})`);
      if (current === state) current = null;
      // No auto-restart — the probe is used for setup, not runtime. If it
      // dies, the UI will let the user reopen the channel grid.
    });
    current = state;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function stopChannelProbe(): Promise<void> {
  const state = current;
  if (!state) return;
  current = null;
  state.intentionalStop = true;
  try { state.proc.kill("SIGTERM"); } catch { /* noop */ }
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

export function isProbing(): boolean {
  return current !== null;
}
