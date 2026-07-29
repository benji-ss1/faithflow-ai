// captureTier.ts — resolves which native capture tier the main process
// uses. The Swift helper (Tier 3) is PREFERRED when its binary is present
// and healthy; the ffmpeg pipeline (v0.1.80, field-proven) is the fallback
// and stays fully intact. Chromium getUserMedia remains the renderer-side
// last resort — untouched here.
//
// Resolution is cached per session. A mid-session Swift failure calls
// forceFfmpegTier() so subsequent commands degrade without renderer impact.

import { swiftHelper, swiftHelperBinaryExists } from "./swiftHelper";

export type CaptureTier = "swift" | "ffmpeg";

let resolved: Promise<CaptureTier> | null = null;
let forced: CaptureTier | null = null;

export async function resolveCaptureTier(): Promise<CaptureTier> {
  if (forced) return forced;
  if (resolved) return resolved;
  resolved = (async (): Promise<CaptureTier> => {
    if (process.platform !== "darwin" || !swiftHelperBinaryExists()) {
      console.log("[audio-native] tier: ffmpeg (swift helper binary absent)");
      return "ffmpeg";
    }
    try {
      // Health check: spawn + list-devices must answer within 2s.
      const ok = await swiftHelper.ensureRunning(2000);
      if (!ok) {
        console.log("[audio-native] tier: ffmpeg (swift helper failed readiness check)");
        return "ffmpeg";
      }
      const devices = await swiftHelper.listDevices(2000);
      if (devices.length === 0) {
        // A Mac ALWAYS has at least the built-in mic; an empty list means
        // the helper is not actually talking to CoreAudio. Don't trust it.
        console.log("[audio-native] tier: ffmpeg (swift helper returned no devices)");
        return "ffmpeg";
      }
      console.log(`[audio-native] tier: swift (${devices.length} devices)`);
      return "swift";
    } catch (err) {
      console.warn("[audio-native] tier: ffmpeg (swift probe threw)", err);
      return "ffmpeg";
    }
  })();
  return resolved;
}

/** Mid-session degrade: swift misbehaved — pin to ffmpeg for this session. */
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
