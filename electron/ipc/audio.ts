import { ipcMain, desktopCapturer, systemPreferences, BrowserWindow } from "electron";
import { isNativeCaptureAvailable } from "../audio/ffmpegPath";
import { listNativeDevices } from "../audio/deviceList";
import {
  startCapture as nativeStartCapture,
  stopCapture as nativeStopCapture,
  setCaptureTarget,
  type StartCaptureOpts,
} from "../audio/nativeCapture";
import {
  startChannelProbe as nativeStartChannelProbe,
  stopChannelProbe as nativeStopChannelProbe,
  setProbeTarget,
  type StartProbeOpts,
} from "../audio/multiChannelProbe";
import { swiftHelper, setSwiftHelperTarget, toNativeDevices } from "../audio/swiftHelper";
import { resolveCaptureTier, forceFfmpegTier } from "../audio/captureTier";

export function registerAudioIpc() {
  // Lets the renderer distinguish "macOS never granted this app mic access
  // at all" from "getUserMedia failed for some other reason" — see
  // useAudioStream.ts's NotAllowedError handling. Only meaningful on macOS;
  // other platforms don't have this TCC-style permission model, so
  // getMediaAccessStatus returns "not-determined" there and the renderer
  // falls back to its existing generic message.
  ipcMain.handle("audio:getMicPermissionStatus", () => {
    if (process.platform !== "darwin") return "not-applicable";
    try {
      return systemPreferences.getMediaAccessStatus("microphone");
    } catch {
      return "unknown";
    }
  });

  // Renderer will do device enumeration itself via navigator.mediaDevices.
  // This handler returns a hint payload; the actual list is fetched renderer-side.
  ipcMain.handle("audio:listInputs", async () => {
    return {
      // The renderer should call navigator.mediaDevices.enumerateDevices()
      // after this returns; permissions are pre-approved in main.ts.
      strategy: "renderer-mediadevices",
      note: "Call navigator.mediaDevices.enumerateDevices() in renderer",
    };
  });

  ipcMain.handle("audio:listSystemSources", async () => {
    try {
      // Electron's typings restrict types to screen|window; audio-loopback is
      // exposed on Windows through desktopCapturer with these types too — the
      // sources' capabilities are read renderer-side via getUserMedia constraints.
      const sources = await desktopCapturer.getSources({ types: ["screen", "window"] });
      return sources.map((s) => ({
        id: s.id,
        name: s.name,
        display_id: s.display_id,
      }));
    } catch (err) {
      return { error: (err as Error).message, sources: [] };
    }
  });
}

/**
 * Native-capture IPC surface. Registered separately from the legacy
 * getUserMedia handlers so the existing renderer path is not disturbed.
 * Wave 2 code (renderer integration) targets this namespace.
 *
 * `getMainWindow` is a lazy getter — main.ts's mainWindow is null before
 * app.whenReady, and can be reassigned across window lifecycle events.
 * We resolve it fresh on every event send.
 */
export function registerNativeAudioIpc(getMainWindow: () => BrowserWindow | null) {
  setCaptureTarget(getMainWindow);
  setProbeTarget(getMainWindow);
  setSwiftHelperTarget(getMainWindow);

  ipcMain.handle("audio:native:isAvailable", async () => {
    // Available if EITHER tier can capture. Tier order: swift → ffmpeg.
    try {
      if ((await resolveCaptureTier()) === "swift") return true;
    } catch (err) {
      console.warn("[audio:native:isAvailable] tier probe", err);
    }
    try {
      return await isNativeCaptureAvailable();
    } catch (err) {
      console.warn("[audio:native:isAvailable]", err);
      return false;
    }
  });

  ipcMain.handle("audio:native:listDevices", async () => {
    try {
      if ((await resolveCaptureTier()) === "swift") {
        const devices = await swiftHelper.listDevices();
        if (devices.length > 0) return toNativeDevices(devices);
        // Swift answered but with nothing — degrade for this call only.
        console.warn("[audio:native:listDevices] swift returned empty; using ffmpeg list");
      }
      return await listNativeDevices();
    } catch (err) {
      console.warn("[audio:native:listDevices]", err);
      return [];
    }
  });

  ipcMain.handle("audio:native:startCapture", async (_e, opts: unknown) => {
    // Basic shape validation — the renderer is trusted (contextIsolated
    // preload) but we still guard against typos.
    if (!opts || typeof opts !== "object") {
      return { ok: false, error: "invalid opts" };
    }
    const o = opts as StartCaptureOpts;
    if (typeof o.deviceIndex !== "number" || !Number.isFinite(o.deviceIndex)) {
      return { ok: false, error: "deviceIndex must be a number" };
    }
    const cleanOpts = {
      deviceIndex: o.deviceIndex,
      channelFilter: typeof o.channelFilter === "string" ? o.channelFilter : undefined,
      sampleRate: typeof o.sampleRate === "number" ? o.sampleRate : undefined,
      channels: typeof o.channels === "number" ? o.channels : undefined,
    };
    if ((await resolveCaptureTier()) === "swift") {
      try {
        const res = await swiftHelper.startCapture({
          deviceIndex: cleanOpts.deviceIndex,
          channelFilter: cleanOpts.channelFilter,
        });
        if (res.ok) return res;
        // Swift start failed — degrade to ffmpeg for the session and retry
        // the command once (per-call graceful degrade).
        forceFfmpegTier(`startCapture failed: ${res.error ?? "unknown"}`);
      } catch (err) {
        forceFfmpegTier(`startCapture threw: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return nativeStartCapture(cleanOpts);
  });

  ipcMain.handle("audio:native:stopCapture", async () => {
    // Stop both tiers — cheap no-ops on the inactive one, and covers a
    // capture that started on swift before a mid-session degrade.
    await Promise.allSettled([swiftHelper.stopCapture(), nativeStopCapture()]);
    return { ok: true };
  });

  ipcMain.handle("audio:native:startChannelProbe", async (_e, opts: unknown) => {
    if (!opts || typeof opts !== "object") {
      return { ok: false, error: "invalid opts" };
    }
    const o = opts as StartProbeOpts;
    if (typeof o.deviceIndex !== "number" || typeof o.channelCount !== "number") {
      return { ok: false, error: "deviceIndex and channelCount required" };
    }
    if ((await resolveCaptureTier()) === "swift") {
      try {
        const res = await swiftHelper.startChannelProbe({ deviceIndex: o.deviceIndex });
        if (res.ok) return res;
        forceFfmpegTier(`startChannelProbe failed: ${res.error ?? "unknown"}`);
      } catch (err) {
        forceFfmpegTier(
          `startChannelProbe threw: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    return nativeStartChannelProbe({
      deviceIndex: o.deviceIndex,
      channelCount: o.channelCount,
    });
  });

  ipcMain.handle("audio:native:stopChannelProbe", async () => {
    await Promise.allSettled([swiftHelper.stopChannelProbe(), nativeStopChannelProbe()]);
    return { ok: true };
  });
}

/**
 * Called from main.ts on window-close / before-quit so ffmpeg subprocesses
 * never outlive the Electron main process.
 */
export async function stopAllNativeAudio(): Promise<void> {
  await Promise.allSettled([
    nativeStopCapture(),
    nativeStopChannelProbe(),
    swiftHelper.shutdown(),
  ]);
}
