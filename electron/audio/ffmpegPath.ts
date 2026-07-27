// ffmpegPath.ts — resolves the bundled ffmpeg binary path in both
// dev (node_modules) and production (asar.unpacked). Isolated in its own
// file so nativeCapture/multiChannelProbe/deviceList can share it without
// each having to reason about the packaging layout.

import { app } from "electron";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
// The ffmpeg-static package's default export is a string path. We import as
// unknown and cast so the compile isn't dependent on the (currently
// TypeScript-less) upstream module's exported type shape.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegStaticRaw = require("ffmpeg-static") as string | null;

let cachedAvailability: boolean | null = null;

export function getFfmpegPath(): string {
  if (!ffmpegStaticRaw || typeof ffmpegStaticRaw !== "string") {
    throw new Error("ffmpeg-static did not resolve to a path");
  }
  if (app && app.isPackaged) {
    // In a packaged Electron app, node_modules lives inside app.asar. We
    // asarUnpack ffmpeg-static in the electron-builder config so the binary
    // is also present at app.asar.unpacked/... — the ffmpeg-static path
    // points into app.asar (unusable for exec) so we rewrite it.
    return ffmpegStaticRaw.replace("app.asar", "app.asar.unpacked");
  }
  return ffmpegStaticRaw;
}

/**
 * True iff ffmpeg-static resolved to an executable AND a dummy invocation
 * succeeded. Renderers use this to choose native vs Chromium capture.
 * Cached — first call may take ~100-300ms; subsequent calls are instant.
 */
export async function isNativeCaptureAvailable(): Promise<boolean> {
  if (cachedAvailability !== null) return cachedAvailability;
  try {
    const p = getFfmpegPath();
    // Sanity check: file exists and is executable. On packaged mac builds an
    // asarUnpack misconfiguration would produce a path that exists inside the
    // asar archive but not on disk — statSync throws in that case.
    fs.statSync(p);
  } catch {
    cachedAvailability = false;
    return false;
  }
  const ok = await new Promise<boolean>((resolve) => {
    try {
      const proc = spawn(getFfmpegPath(), ["-hide_banner", "-version"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        try { proc.kill("SIGKILL"); } catch { /* noop */ }
        resolve(false);
      }, 3000);
      proc.on("close", (code) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(code === 0);
      });
      proc.on("error", () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
  cachedAvailability = ok;
  return ok;
}
