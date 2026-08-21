// swiftHelper.ts — lifecycle + protocol manager for the Tier 3 native Swift
// audio helper (native/macos → resources/native/macos/PresentFlowAudioHelper).
//
// Wire protocol (mirror of native/macos/Sources/.../main.swift):
//   helper stdin  : line-delimited JSON commands
//   helper stdout : RAW s16le 16kHz mono PCM — nothing else
//   helper stderr : line-delimited JSON events
//
// This module emits the EXACT same webContents channels as the ffmpeg tier
// (nativeCapture.ts / multiChannelProbe.ts) so the renderer needs zero
// changes: audio:nativePcmChunk, audio:nativeLevel, audio:nativeError,
// audio:nativeChannelLevels — plus one additive channel,
// audio:nativeDeviceChange, from CoreAudio hot-plug notifications.

import { spawn, ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import * as fs from "node:fs";
import * as path from "node:path";
import { app, BrowserWindow } from "electron";
import { CHANNELS } from "./nativeCapture";
import { PROBE_CHANNELS } from "./multiChannelProbe";
import type { NativeDevice } from "./deviceList";

// ---------------------------------------------------------------------------
// Protocol types + pure parse/serialize functions (exported for tests)
// ---------------------------------------------------------------------------

export type HelperCommand =
  | { cmd: "list-devices" }
  | { cmd: "start-capture"; device_uid: string; channels: number[]; gain: number }
  | { cmd: "stop-capture" }
  | { cmd: "set-channel"; channels: number[] }
  | { cmd: "set-gain"; gain: number }
  | { cmd: "probe-channels"; device_uid?: string }
  | { cmd: "stop-probe" }
  | { cmd: "quit" };

export type HelperDevice = {
  index: number;
  uid: string;
  name: string;
  manufacturer?: string;
  transport?: string;
  input_channels?: number;
  sample_rate?: number;
  is_default?: boolean;
};

export type HelperEvent =
  | { event: "ready"; version?: number }
  | { event: "devices"; devices: HelperDevice[] }
  | { event: "capturing"; device_uid: string; channels?: number[]; gain?: number }
  | { event: "stopped" }
  | { event: "level"; rms: number; peak: number; db: number }
  | { event: "channel-levels"; levels: Array<{ channel: number; rms: number; peak: number; db: number }> }
  | { event: "probing"; device_uid?: string }
  | { event: "probe-stopped" }
  | { event: "device-change" }
  | { event: "error"; code?: string; message: string }
  | { event: "log"; message: string };

/** Serialize a command as a single newline-terminated JSON line. */
export function serializeCommand(cmd: HelperCommand): string {
  return JSON.stringify(cmd) + "\n";
}

// Defensive cap: no legitimate helper event is anywhere near this size
// (a 64-device list is <32KB). Oversized lines are dropped, not buffered
// forever — protects against a wedged/corrupt helper flooding stderr.
export const MAX_EVENT_LINE_BYTES = 256 * 1024;

/**
 * Parse one stderr line into a HelperEvent. Returns null for anything
 * malformed — the caller logs and moves on; a bad line must never crash
 * the capture path.
 */
export function parseHelperEventLine(line: string): HelperEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (Buffer.byteLength(trimmed, "utf8") > MAX_EVENT_LINE_BYTES) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const ev = (obj as { event?: unknown }).event;
  if (typeof ev !== "string" || !ev) return null;
  switch (ev) {
    case "devices": {
      const devices = (obj as { devices?: unknown }).devices;
      if (!Array.isArray(devices)) return null;
      const clean: HelperDevice[] = [];
      for (const d of devices) {
        // Skip a malformed entry rather than discarding the WHOLE list — one
        // bad (e.g. untrusted NDI) device must never blank the operator's real
        // CoreAudio mic from the picker.
        if (!d || typeof d !== "object") continue;
        const dd = d as Record<string, unknown>;
        if (typeof dd.uid !== "string" || typeof dd.name !== "string") continue;
        clean.push({
          index: typeof dd.index === "number" ? dd.index : clean.length,
          uid: dd.uid,
          name: dd.name,
          manufacturer: typeof dd.manufacturer === "string" ? dd.manufacturer : undefined,
          transport: typeof dd.transport === "string" ? dd.transport : undefined,
          input_channels: typeof dd.input_channels === "number" ? dd.input_channels : undefined,
          sample_rate: typeof dd.sample_rate === "number" ? dd.sample_rate : undefined,
          is_default: typeof dd.is_default === "boolean" ? dd.is_default : undefined,
        });
      }
      return { event: "devices", devices: clean };
    }
    case "level": {
      const o = obj as Record<string, unknown>;
      if (typeof o.rms !== "number" || typeof o.peak !== "number" || typeof o.db !== "number") {
        return null;
      }
      return { event: "level", rms: o.rms, peak: o.peak, db: o.db };
    }
    case "channel-levels": {
      const levels = (obj as { levels?: unknown }).levels;
      if (!Array.isArray(levels)) return null;
      const clean: Array<{ channel: number; rms: number; peak: number; db: number }> = [];
      for (const l of levels) {
        if (!l || typeof l !== "object") return null;
        const ll = l as Record<string, unknown>;
        if (
          typeof ll.rms !== "number" ||
          typeof ll.peak !== "number" ||
          typeof ll.db !== "number"
        ) {
          return null;
        }
        clean.push({
          channel: typeof ll.channel === "number" ? ll.channel : clean.length,
          rms: ll.rms,
          peak: ll.peak,
          db: ll.db,
        });
      }
      return { event: "channel-levels", levels: clean };
    }
    case "error": {
      const o = obj as Record<string, unknown>;
      if (typeof o.message !== "string") return null;
      return {
        event: "error",
        code: typeof o.code === "string" ? o.code : undefined,
        message: o.message,
      };
    }
    case "capturing": {
      const o = obj as Record<string, unknown>;
      if (typeof o.device_uid !== "string") return null;
      return {
        event: "capturing",
        device_uid: o.device_uid,
        channels: Array.isArray(o.channels)
          ? o.channels.filter((c): c is number => typeof c === "number")
          : undefined,
        gain: typeof o.gain === "number" ? o.gain : undefined,
      };
    }
    case "log": {
      const o = obj as Record<string, unknown>;
      return { event: "log", message: typeof o.message === "string" ? o.message : "" };
    }
    case "ready":
    case "stopped":
    case "probing":
    case "probe-stopped":
    case "device-change":
      return obj as HelperEvent;
    default:
      // Unknown event type from a newer helper — ignore, don't crash.
      return null;
  }
}

/**
 * Incremental newline splitter for the stderr stream. Handles partial
 * chunks, multi-line chunks, and enforces MAX_EVENT_LINE_BYTES so a
 * newline-less flood can't grow the buffer unboundedly.
 */
export class LineSplitter {
  private buffer = "";
  private overflowed = false;

  push(chunk: Buffer | string): string[] {
    this.buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const out: string[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (this.overflowed) {
        // This "line" is the tail of an oversized line — drop it, reset.
        this.overflowed = false;
        continue;
      }
      out.push(line);
    }
    if (Buffer.byteLength(this.buffer, "utf8") > MAX_EVENT_LINE_BYTES) {
      this.buffer = "";
      this.overflowed = true;
    }
    return out;
  }
}

/**
 * Translate the ffmpeg `pan=` channel filter (baked by the renderer's
 * nativeDeviceStore — e.g. "pan=mono|c0=c5" or
 * "pan=mono|c0=0.5*c4+0.5*c5") into the helper's channel index array.
 * No filter → channel 0. Unparseable → channel 0 (safe default, matches
 * ffmpeg behavior of a passthrough first channel).
 */
export function parseChannelFilter(filter?: string): number[] {
  if (!filter || typeof filter !== "string") return [0];
  const rhs = filter.split("=").slice(1).join("=");
  const matches = [...rhs.matchAll(/c(\d+)/g)]
    .map((m) => parseInt(m[1], 10))
    .filter((n) => Number.isFinite(n) && n >= 0 && n < 256);
  // First cN in "pan=mono|c0=..." is the OUTPUT channel c0 — skip it when
  // there are source channels after it.
  const sources = matches.length > 1 ? matches.slice(1) : matches;
  const unique = [...new Set(sources)];
  return unique.length > 0 ? unique : [0];
}

// ---------------------------------------------------------------------------
// Helper binary resolution
// ---------------------------------------------------------------------------

export function getSwiftHelperPath(): string {
  if (app && app.isPackaged) {
    return path.join(process.resourcesPath, "native", "macos", "PresentFlowAudioHelper");
  }
  // Dev: repo-root/resources/native/macos (build.sh output).
  return path.join(__dirname, "..", "..", "resources", "native", "macos", "PresentFlowAudioHelper");
}

/**
 * Absolute path to the bundled NDI runtime dylib (universal libndi.dylib,
 * copied from the license-gated "NDI SDK for Apple" — see native/macos/build.sh).
 * Passed to the helper via `--ndi-runtime` so it dlopen()s our bundled copy
 * FIRST, before falling back to NDI_RUNTIME_DIR_V5 / /usr/local/lib. Mirrors
 * getSwiftHelperPath()'s packaged-vs-dev resolution. The file may be absent
 * (e.g. dev machine without the SDK yet) — the helper degrades gracefully and
 * simply serves CoreAudio devices with no NDI sources.
 */
export function getBundledNdiRuntimePath(): string {
  if (app && app.isPackaged) {
    return path.join(process.resourcesPath, "native", "macos", "libndi.dylib");
  }
  return path.join(__dirname, "..", "..", "resources", "native", "macos", "libndi.dylib");
}

export function swiftHelperBinaryExists(): boolean {
  if (process.platform !== "darwin") return false;
  try {
    const st = fs.statSync(getSwiftHelperPath());
    return st.isFile();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Process manager
// ---------------------------------------------------------------------------

type HelperProc = ChildProcessByStdio<Writable, Readable, Readable>;

type CaptureParams = {
  deviceUid: string;
  channels: number[];
  gain: number;
  // Original renderer-shape args, kept so the exhaustion failover can hand
  // the SAME capture request to the ffmpeg tier (which speaks index+filter).
  deviceIndex: number;
  channelFilter?: string;
};

const RESTART_BACKOFF_MS = [2000, 4000, 8000, 16000, 30000];
const READY_TIMEOUT_MS = 2000;

let getTargetWindow: () => BrowserWindow | null = () => null;

export function setSwiftHelperTarget(getter: () => BrowserWindow | null) {
  getTargetWindow = getter;
}

function send(channel: string, payload: unknown) {
  const win = getTargetWindow();
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.send(channel, payload);
  } catch {
    /* window tearing down */
  }
}

function suggestionForCode(code?: string): string | undefined {
  switch (code) {
    case "start-failed":
    case "probe-failed":
      return "Check the device connection and reselect the input.";
    case "config-change-restart-failed":
      return "Reconnect the USB cable, then choose the device again from the list.";
    default:
      return undefined;
  }
}

class SwiftHelperManager {
  private proc: HelperProc | null = null;
  private splitter = new LineSplitter();
  private ready = false;
  private readyWaiters: Array<(ok: boolean) => void> = [];
  private devicesWaiters: Array<(devices: HelperDevice[]) => void> = [];
  private lastDevices: HelperDevice[] = [];
  private capture: CaptureParams | null = null;
  private probing = false;
  private probeDeviceUid: string | null = null;
  private intentionalStop = false;
  private restartAttempts = 0;
  private restartTimer: NodeJS.Timeout | null = null;
  private shuttingDown = false;

  /** Spawn (if needed) and wait for the `ready` event. */
  async ensureRunning(timeoutMs = READY_TIMEOUT_MS): Promise<boolean> {
    if (this.shuttingDown) return false;
    if (this.proc && this.ready) return true;
    if (!swiftHelperBinaryExists()) return false;
    if (!this.proc) {
      try {
        this.spawnProc();
      } catch (err) {
        console.warn("[swiftHelper] spawn failed:", err);
        return false;
      }
    }
    if (this.ready) return true;
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        finish(false);
      }, timeoutMs);
      const finish = (ok: boolean) => {
        clearTimeout(timer);
        this.readyWaiters = this.readyWaiters.filter((w) => w !== waiter);
        resolve(ok);
      };
      const waiter = (ok: boolean) => finish(ok);
      this.readyWaiters.push(waiter);
    });
  }

  private spawnProc() {
    const bin = getSwiftHelperPath();
    // Point the helper at our bundled NDI runtime. The helper treats a
    // missing/unloadable dylib as "no NDI" (never fatal), so we always pass
    // the path even when the file isn't present yet.
    const args = ["--ndi-runtime", getBundledNdiRuntimePath()];
    // Optional discovery targeting for segmented church networks where mDNS
    // can't cross subnets/VLANs: set PRESENTFLOW_NDI_EXTRA_IPS (comma/space
    // list of sender IPs) and/or PRESENTFLOW_NDI_GROUPS. No rebuild needed —
    // set the env var and relaunch to make a stubborn source discoverable.
    const extraIps = process.env.PRESENTFLOW_NDI_EXTRA_IPS?.trim();
    if (extraIps) args.push("--ndi-extra-ips", extraIps);
    const groups = process.env.PRESENTFLOW_NDI_GROUPS?.trim();
    if (groups) args.push("--ndi-groups", groups);
    const proc = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    this.proc = proc;
    this.ready = false;
    this.splitter = new LineSplitter();

    proc.stdout.on("data", (chunk: Buffer) => {
      // stdout is raw PCM only. Copy to an exact-range ArrayBuffer (Node
      // Buffers share the pool; sending as-is would leak neighbor bytes).
      const ab = chunk.buffer.slice(
        chunk.byteOffset,
        chunk.byteOffset + chunk.byteLength
      ) as ArrayBuffer;
      send(CHANNELS.pcmChunk, ab);
      if (this.restartAttempts > 0) this.restartAttempts = 0;
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      for (const line of this.splitter.push(chunk)) {
        const ev = parseHelperEventLine(line);
        if (!ev) {
          if (line.trim()) console.warn(`[swiftHelper] unparseable event: ${line.slice(0, 200)}`);
          continue;
        }
        this.handleEvent(ev);
      }
    });

    proc.on("error", (err) => {
      console.error("[swiftHelper] process error:", err);
      this.flushWaiters(false);
      send(CHANNELS.error, { message: `Audio helper failed to start: ${err.message}` });
    });

    proc.on("close", (code, signal) => {
      console.log(
        `[swiftHelper] exited (code=${code}, signal=${signal}, intentional=${this.intentionalStop})`
      );
      if (this.proc === proc) {
        this.proc = null;
        this.ready = false;
      }
      this.flushWaiters(false);
      if (this.intentionalStop || this.shuttingDown) {
        this.intentionalStop = false;
        return;
      }
      if (this.capture) this.scheduleRestart();
    });
  }

  private flushWaiters(ok: boolean) {
    const readyW = this.readyWaiters;
    this.readyWaiters = [];
    readyW.forEach((w) => w(ok));
    const devW = this.devicesWaiters;
    this.devicesWaiters = [];
    devW.forEach((w) => w([]));
  }

  private handleEvent(ev: HelperEvent) {
    switch (ev.event) {
      case "ready": {
        this.ready = true;
        const waiters = this.readyWaiters;
        this.readyWaiters = [];
        waiters.forEach((w) => w(true));
        break;
      }
      case "devices": {
        this.lastDevices = ev.devices;
        const waiters = this.devicesWaiters;
        this.devicesWaiters = [];
        waiters.forEach((w) => w(ev.devices));
        break;
      }
      case "level":
        send(CHANNELS.level, { rms: ev.rms, db: ev.db, peak: ev.peak });
        break;
      case "channel-levels":
        // Same payload shape as multiChannelProbe's flushLevels.
        send(
          PROBE_CHANNELS.levels,
          ev.levels.map((l) => ({ channel: l.channel, rms: l.rms, db: l.db, peak: l.peak }))
        );
        break;
      case "error":
        console.warn(`[swiftHelper] error event: ${ev.code ?? "?"} — ${ev.message}`);
        send(CHANNELS.error, {
          message: ev.message,
          suggestion: suggestionForCode(ev.code),
        });
        break;
      case "device-change":
        // Additive channel — renderer's navigator devicechange still fires
        // independently; this covers HAL-only devices Chromium can't see AND
        // NDI network sources appearing/disappearing on the LAN (the helper
        // emits the same event from its NDI discovery poll), giving the picker
        // OBS/DistroAV-style live source updates.
        send("audio:nativeDeviceChange", { source: "native" });
        break;
      case "log":
        console.log(`[swiftHelper] ${ev.message}`);
        break;
      case "capturing":
      case "stopped":
      case "probing":
      case "probe-stopped":
        console.log(`[swiftHelper] ${ev.event}`);
        break;
    }
  }

  private sendCommand(cmd: HelperCommand): boolean {
    const proc = this.proc;
    if (!proc || !proc.stdin.writable) return false;
    try {
      proc.stdin.write(serializeCommand(cmd));
      return true;
    } catch (err) {
      console.warn("[swiftHelper] stdin write failed:", err);
      return false;
    }
  }

  async listDevices(timeoutMs = 3000): Promise<HelperDevice[]> {
    const running = await this.ensureRunning();
    if (!running) return [];
    return new Promise<HelperDevice[]>((resolve) => {
      const timer = setTimeout(() => {
        this.devicesWaiters = this.devicesWaiters.filter((w) => w !== waiter);
        resolve([]);
      }, timeoutMs);
      const waiter = (devices: HelperDevice[]) => {
        clearTimeout(timer);
        resolve(devices);
      };
      this.devicesWaiters.push(waiter);
      if (!this.sendCommand({ cmd: "list-devices" })) {
        clearTimeout(timer);
        this.devicesWaiters = this.devicesWaiters.filter((w) => w !== waiter);
        resolve([]);
      }
    });
  }

  /** Resolve an enumeration index (the renderer's persisted shape) to a UID. */
  private async resolveUid(deviceIndex: number): Promise<string | null> {
    // Fresh enumeration first — indexes are positional and a replug may
    // have reordered them (which is exactly why we capture by UID).
    const devices = await this.listDevices();
    const list = devices.length > 0 ? devices : this.lastDevices;
    const match = list.find((d) => d.index === deviceIndex);
    return match?.uid ?? null;
  }

  async startCapture(opts: {
    deviceIndex: number;
    channelFilter?: string;
  }): Promise<{ ok: boolean; error?: string }> {
    const running = await this.ensureRunning();
    if (!running) return { ok: false, error: "swift helper unavailable" };
    const uid = await this.resolveUid(opts.deviceIndex);
    if (!uid) return { ok: false, error: `no device at index ${opts.deviceIndex}` };
    const channels = parseChannelFilter(opts.channelFilter);
    this.capture = { deviceUid: uid, channels, gain: 1.0, deviceIndex: opts.deviceIndex, channelFilter: opts.channelFilter };
    this.intentionalStop = false;
    if (!this.sendCommand({ cmd: "start-capture", device_uid: uid, channels, gain: 1.0 })) {
      this.capture = null;
      return { ok: false, error: "helper stdin write failed" };
    }
    return { ok: true };
  }

  async stopCapture(): Promise<void> {
    this.capture = null;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.sendCommand({ cmd: "stop-capture" });
  }

  setChannels(channels: number[]): boolean {
    if (this.capture) this.capture.channels = channels;
    return this.sendCommand({ cmd: "set-channel", channels });
  }

  setGain(gain: number): boolean {
    if (this.capture) this.capture.gain = gain;
    return this.sendCommand({ cmd: "set-gain", gain });
  }

  async startChannelProbe(opts: { deviceIndex: number }): Promise<{ ok: boolean; error?: string }> {
    const running = await this.ensureRunning();
    if (!running) return { ok: false, error: "swift helper unavailable" };
    const uid = await this.resolveUid(opts.deviceIndex);
    if (!uid) return { ok: false, error: `no device at index ${opts.deviceIndex}` };
    this.probing = true;
    this.probeDeviceUid = uid;
    if (!this.sendCommand({ cmd: "probe-channels", device_uid: uid })) {
      this.probing = false;
      return { ok: false, error: "helper stdin write failed" };
    }
    return { ok: true };
  }

  async stopChannelProbe(): Promise<void> {
    this.probing = false;
    this.probeDeviceUid = null;
    this.sendCommand({ cmd: "stop-probe" });
  }

  isCapturing(): boolean {
    return this.capture !== null;
  }

  private scheduleRestart() {
    const attempt = this.restartAttempts;
    if (attempt >= RESTART_BACKOFF_MS.length) {
      // Review fix (B-1, 2026-07-29): don't strand the session on a toast a
      // live-service operator may never notice. Flip the tier to ffmpeg and
      // let the renderer's existing restart path (the error event triggers
      // useAudioStream's recovery) reopen capture on the proven fallback.
      const params = this.capture;
      this.capture = null;
      send(CHANNELS.error, {
        message: "Native audio helper failed repeatedly — switching to the fallback capture engine.",
        suggestion: "Audio should recover automatically. If not, reselect the input in Settings › Audio.",
      });
      try {
        // Lazy import to avoid a cycle at module load.
        const { forceFfmpegTier } = require("./captureTier") as typeof import("./captureTier");
        forceFfmpegTier("swift restart budget exhausted");
        if (params) {
          const { startCapture: ffmpegStart } = require("./nativeCapture") as typeof import("./nativeCapture");
          void ffmpegStart({
            deviceIndex: params.deviceIndex,
            channelFilter: params.channelFilter,
            sampleRate: 16000,
            channels: 1,
          });
        }
      } catch (err) {
        console.warn("[swiftHelper] ffmpeg failover after exhaustion failed:", err);
      }
      return;
    }
    const delay = RESTART_BACKOFF_MS[attempt];
    this.restartAttempts = attempt + 1;
    console.log(`[swiftHelper] restarting in ${delay}ms (attempt ${attempt + 1})`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void (async () => {
        const params = this.capture;
        if (!params) return; // stopCapture won during the wait
        const ok = await this.ensureRunning();
        if (!ok) {
          this.scheduleRestart();
          return;
        }
        if (
          !this.sendCommand({
            cmd: "start-capture",
            device_uid: params.deviceUid,
            channels: params.channels,
            gain: params.gain,
          })
        ) {
          this.scheduleRestart();
          return;
        }
        if (this.probing && this.probeDeviceUid) {
          this.sendCommand({ cmd: "probe-channels", device_uid: this.probeDeviceUid });
        }
      })();
    }, delay);
  }

  /** Graceful teardown — quit command, then SIGKILL safety net. */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.intentionalStop = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.capture = null;
    const proc = this.proc;
    if (!proc) {
      // Review fix (2026-07-29): leaving shuttingDown latched with no proc
      // bricks ensureRunning for the rest of the session if shutdown is
      // ever called outside app-quit (e.g. window reload).
      this.shuttingDown = false;
      return;
    }
    this.sendCommand({ cmd: "quit" });
    await new Promise<void>((resolve) => {
      let settled = false;
      const to = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          proc.kill("SIGKILL");
        } catch {
          /* noop */
        }
        resolve();
      }, 1000);
      proc.once("close", () => {
        if (settled) return;
        settled = true;
        clearTimeout(to);
        resolve();
      });
    });
    this.proc = null;
    this.shuttingDown = false;
  }
}

export const swiftHelper = new SwiftHelperManager();

/**
 * Map helper devices to the ffmpeg-tier NativeDevice shape (+ uid + transport).
 * `transport` is preserved so the renderer can badge network (NDI) sources
 * distinctly — an NDI source arrives here exactly like any CoreAudio device,
 * only its uid (`ndi://<name>`) and transport (`"ndi"`) differ.
 */
export function toNativeDevices(
  devices: HelperDevice[]
): Array<NativeDevice & { uid: string; transport?: string }> {
  return devices.map((d) => ({
    index: d.index,
    name: d.name,
    platform: "darwin" as const,
    channelCount: d.input_channels,
    sampleRate: d.sample_rate,
    uid: d.uid,
    transport: d.transport,
  }));
}
