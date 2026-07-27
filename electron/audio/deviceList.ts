// deviceList.ts — native input device enumeration.
//
// Chromium's navigator.mediaDevices.enumerateDevices() filters devices to a
// consumer subset and reports 32-channel pro interfaces (Allen & Heath SQ,
// Behringer X32, etc.) as available but returns SILENT frames from them —
// confirmed at JPD field test. This module bypasses Chromium entirely and
// asks ffmpeg what CoreAudio (macOS) / DirectShow (Windows) actually sees,
// which matches what OBS / Logic report.

import { spawn } from "node:child_process";
import { getFfmpegPath } from "./ffmpegPath";

export type NativeDevice = {
  index: number;
  name: string;
  platform: "darwin" | "win32" | "linux";
  channelCount?: number;
  sampleRate?: number;
};

const AVFOUNDATION_LINE_RE = /\[AVFoundation indev[^\]]*\]\s+\[(\d+)\]\s+(.+)$/gm;
// dshow lines look like:
//   [dshow @ 0x14a00c910]  "Microphone (USB Audio)" (audio)
//   [dshow @ 0x14a00c910]     Alternative name "@device_cm_..."
// We want the friendly name — the (audio) tagged first line — because the
// -i flag on Windows accepts `audio=<friendly name>` or the alt device path.
const DSHOW_AUDIO_LINE_RE = /\[dshow @ [^\]]+\]\s+"([^"]+)"\s+\(audio\)/gm;

function runFfmpegForDeviceList(args: string[], timeoutMs = 5000): Promise<string> {
  return new Promise((resolve) => {
    let ffmpeg: string;
    try {
      ffmpeg = getFfmpegPath();
    } catch (err) {
      resolve("");
      return;
    }
    const proc = spawn(ffmpeg, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    // ffmpeg emits `-list_devices` output on stderr with a non-zero exit —
    // that's normal for this incantation, not an error.
    proc.stderr.on("data", (b: Buffer) => chunks.push(b));
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { proc.kill("SIGKILL"); } catch { /* noop */ }
      resolve(Buffer.concat(chunks).toString("utf8"));
    }, timeoutMs);
    proc.on("close", () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    proc.on("error", () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

function parseAvfoundationAudio(stderr: string): Array<{ index: number; name: string }> {
  // The stderr contains BOTH video and audio blocks. Slice at the "audio
  // devices:" header so we only match numbered lines under that section.
  const marker = stderr.indexOf("AVFoundation audio devices:");
  if (marker === -1) return [];
  const audioSection = stderr.slice(marker);
  const out: Array<{ index: number; name: string }> = [];
  AVFOUNDATION_LINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AVFOUNDATION_LINE_RE.exec(audioSection)) !== null) {
    const idx = parseInt(m[1], 10);
    const name = m[2].trim();
    if (Number.isFinite(idx) && name) out.push({ index: idx, name });
  }
  return out;
}

function parseDshowAudio(stderr: string): Array<{ index: number; name: string }> {
  // dshow doesn't expose numeric indices — the input flag takes the friendly
  // name string. We still assign array indices so callers have a stable
  // identifier, but capture uses name.
  const out: Array<{ index: number; name: string }> = [];
  DSHOW_AUDIO_LINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = DSHOW_AUDIO_LINE_RE.exec(stderr)) !== null) {
    out.push({ index: i++, name: m[1].trim() });
  }
  return out;
}

async function probeChannelCountsMac(devices: NativeDevice[]): Promise<void> {
  // system_profiler is authoritative for CoreAudio input channel counts.
  // ffmpeg's own probe requires actually opening the device (permission
  // dialog + reserves the input), so we prefer system_profiler and fall back
  // to leaving channelCount undefined if it fails / the device isn't found.
  const raw = await new Promise<string>((resolve) => {
    const proc = spawn("system_profiler", ["SPAudioDataType", "-json"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    proc.stdout.on("data", (b) => chunks.push(b));
    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch { /* noop */ }
      resolve(Buffer.concat(chunks).toString("utf8"));
    }, 4000);
    proc.on("close", () => { clearTimeout(timer); resolve(Buffer.concat(chunks).toString("utf8")); });
    proc.on("error", () => { clearTimeout(timer); resolve(""); });
  });
  if (!raw) return;
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { return; }
  const items = parsed?.SPAudioDataType?.[0]?._items;
  if (!Array.isArray(items)) return;
  // Flatten — each item may have nested items for sub-devices.
  const flat: any[] = [];
  const push = (n: any) => {
    if (!n || typeof n !== "object") return;
    flat.push(n);
    if (Array.isArray(n._items)) n._items.forEach(push);
  };
  items.forEach(push);
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  for (const dev of devices) {
    const target = norm(dev.name);
    const match = flat.find((n) => {
      const nm = typeof n?._name === "string" ? norm(n._name) : "";
      // Fuzzy: substring either way. ffmpeg often reports "Default - SQ ..."
      // while system_profiler has just "SQ - Audio", or vice versa.
      return nm && (nm.includes(target) || target.includes(nm));
    });
    if (!match) continue;
    const chIn = match?.coreaudio_device_input;
    if (typeof chIn === "number" && chIn > 0) dev.channelCount = chIn;
    const sr = match?.coreaudio_sample_rate;
    if (typeof sr === "number" && sr > 0) dev.sampleRate = sr;
  }
}

export async function listNativeDevices(): Promise<NativeDevice[]> {
  const platform = process.platform;
  if (platform === "darwin") {
    const stderr = await runFfmpegForDeviceList([
      "-hide_banner",
      "-f", "avfoundation",
      "-list_devices", "true",
      "-i", "",
    ]);
    const parsed = parseAvfoundationAudio(stderr);
    const devices: NativeDevice[] = parsed.map((d) => ({
      index: d.index,
      name: d.name,
      platform: "darwin" as const,
    }));
    // Best-effort — never throw if system_profiler is slow/missing.
    try { await probeChannelCountsMac(devices); } catch { /* noop */ }
    return devices;
  }
  if (platform === "win32") {
    const stderr = await runFfmpegForDeviceList([
      "-hide_banner",
      "-f", "dshow",
      "-list_devices", "true",
      "-i", "dummy",
    ]);
    const parsed = parseDshowAudio(stderr);
    return parsed.map((d) => ({
      index: d.index,
      name: d.name,
      platform: "win32" as const,
    }));
  }
  // Linux is intentionally deprioritized — see spec. Return empty list.
  console.warn("[audio/deviceList] Linux native enumeration not yet implemented");
  return [];
}
