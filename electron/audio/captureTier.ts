// captureTier.ts — resolves which native capture tier the main process
// uses. The Swift helper (Tier 3) is PREFERRED when its binary is present
// and healthy; the ffmpeg pipeline (v0.1.80, field-proven) is the fallback
// and stays fully intact. Chromium getUserMedia remains the renderer-side
// last resort — untouched here.
//
// Hardware I/O Phase B (2026-09-16): an OPT-IN "pro audio driver" tier —
// RtAudio via audify (CoreAudio / WASAPI / ASIO). ON by default (user sign-off
// 2026-09-17); the operator can switch it off in Audio settings (persisted in
// userData). When ON:
//   macOS:   swift → rtaudio → ffmpeg   (field-proven Swift helper stays first)
//   Windows: rtaudio → ffmpeg           (ASIO: every input channel)
// Kill switch: PRESENTFLOW_AUDIO_TIER=ffmpeg|swift|rtaudio pins a tier.
//
// Resolution is cached per session. A mid-session failure calls
// forceFfmpegTier() so subsequent commands degrade without renderer impact.

import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { swiftHelper, swiftHelperBinaryExists } from "./swiftHelper";
import { isRtAudioAvailable, listRtAudioDevices } from "./rtaudioCapture";

export type CaptureTier = "swift" | "rtaudio" | "ffmpeg";

let resolved: Promise<CaptureTier> | null = null;
let forced: CaptureTier | null = null;

// ── pro audio driver opt-in (persisted) ──────────────────────────────────
const PREF_FILE = "audio-driver.json";
let proDriverCache: boolean | null = null;

function prefPath(): string {
  try { return path.join(app.getPath("userData"), PREF_FILE); } catch { return ""; }
}

export function isProDriverEnabled(): boolean {
  if (process.env.PRESENTFLOW_AUDIO_TIER === "rtaudio") return true;
  if (proDriverCache !== null) return proDriverCache;
  // 2026-09-17 (user-directed): ON by default; operators can switch it off.
  proDriverCache = true;
  try {
    const p = prefPath();
    if (p && fs.existsSync(p)) proDriverCache = JSON.parse(fs.readFileSync(p, "utf8"))?.proDriver !== false;
  } catch { /* corrupt file → default on */ }
  return proDriverCache;
}

export function setProDriverEnabled(enabled: boolean): void {
  proDriverCache = enabled;
  try {
    const p = prefPath();
    if (p) fs.writeFileSync(p, JSON.stringify({ proDriver: enabled }));
  } catch (err) {
    console.warn("[audio-native] could not persist pro driver pref", err);
  }
  resolved = null; // re-resolve on next command
  forced = null;
}

function rtaudioHealthy(): boolean {
  const pinned = process.env.PRESENTFLOW_AUDIO_TIER;
  if (pinned === "ffmpeg" || pinned === "swift") return false;
  if (!isProDriverEnabled()) return false;
  try {
    return isRtAudioAvailable() && listRtAudioDevices().length > 0;
  } catch {
    return false;
  }
}

export async function resolveCaptureTier(): Promise<CaptureTier> {
  if (forced) return forced;
  if (resolved) return resolved;
  resolved = (async (): Promise<CaptureTier> => {
    if (process.env.PRESENTFLOW_AUDIO_TIER === "ffmpeg") return "ffmpeg";
    if (process.env.PRESENTFLOW_AUDIO_TIER === "rtaudio" && rtaudioHealthy()) return "rtaudio";
    const fallback = (why: string): CaptureTier => {
      const t: CaptureTier = rtaudioHealthy() ? "rtaudio" : "ffmpeg";
      console.log(`[audio-native] tier: ${t} (${why})`);
      return t;
    };
    if (process.platform !== "darwin" || !swiftHelperBinaryExists()) {
      return fallback("swift helper binary absent");
    }
    try {
      // Health check: spawn + list-devices must answer within 2s.
      const ok = await swiftHelper.ensureRunning(2000);
      if (!ok) return fallback("swift helper failed readiness check");
      const devices = await swiftHelper.listDevices(2000);
      if (devices.length === 0) {
        // A Mac ALWAYS has at least the built-in mic; an empty list means
        // the helper is not actually talking to CoreAudio. Don't trust it.
        return fallback("swift helper returned no devices");
      }
      console.log(`[audio-native] tier: swift (${devices.length} devices)`);
      return "swift";
    } catch (err) {
      console.warn("[audio-native] swift probe threw", err);
      return fallback("swift probe threw");
    }
  })();
  return resolved;
}

/** Mid-session degrade: the active tier misbehaved — pin to ffmpeg for this session. */
export function forceFfmpegTier(reason: string): void {
  if (forced === "ffmpeg") return;
  forced = "ffmpeg";
  console.warn(`[audio-native] tier degraded to ffmpeg: ${reason}`);
}

/** Test-only / dev-tools hook. */
export function resetTierForTesting(): void {
  resolved = null;
  forced = null;
}
