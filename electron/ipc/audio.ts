import { ipcMain, desktopCapturer, systemPreferences, BrowserWindow } from "electron";
import { isNativeCaptureAvailable } from "../audio/ffmpegPath";
import { listNativeDevices, type NativeDevice } from "../audio/deviceList";
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
import {
  resolveCaptureTier, forceFfmpegTier, isProDriverEnabled, setProDriverEnabled,
} from "../audio/captureTier";
import {
  setRtAudioTarget, listRtAudioDevices, startRtAudioCapture, stopRtAudioCapture,
  startRtAudioProbe, stopRtAudioProbe, listDeckLinkAudioDevices, isRtAudioAvailable,
  FRIENDLY_UNAVAILABLE, shutdownRtAudioWorker,
} from "../audio/rtaudioCapture";
import { isDeckLinkIndex, API_INDEX_BASE } from "../audio/rtaudioDsp";

// Hardware I/O Phase B/C tier routing (review-gate hardened 2026-09-16):
//  • Blackmagic (DeckLink) indices route to the DeckLink session on ANY tier.
//  • Starting ANY capture/probe first stops the other tiers' capture/probe, so
//    two PCM streams can never interleave into Deepgram.
//  • A pre-upgrade/ffmpeg-tier index (< API_INDEX_BASE) on the rtaudio tier is
//    served by ffmpeg directly — no error, no session-wide degrade.
//  • rtaudio failures that are the operator's situation (device busy, gone,
//    ASIO single-stream) are REPORTED, never used to disable the tier.

async function stopAllCaptures(): Promise<void> {
  await Promise.allSettled([swiftHelper.stopCapture(), nativeStopCapture(), stopRtAudioCapture()]);
}
async function stopAllProbes(): Promise<void> {
  await Promise.allSettled([swiftHelper.stopChannelProbe(), nativeStopChannelProbe(), stopRtAudioProbe()]);
}

/** Blackmagic inputs join whichever tier's list is active. */
async function withDeckLink(list: NativeDevice[]): Promise<NativeDevice[]> {
  return [...list, ...(await listDeckLinkAudioDevices())];
}

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
  setRtAudioTarget(getMainWindow);

  ipcMain.handle("audio:native:isAvailable", async () => {
    // Available if ANY tier can capture. Tier order: swift → (rtaudio) → ffmpeg.
    try {
      const tier = await resolveCaptureTier();
      if (tier === "swift" || tier === "rtaudio") return true;
      // Windows: the ffmpeg/dshow tier stays locked (renderer rule since the
      // Windows field report) — native is only offered through the pro driver.
      if (process.platform === "win32") return false;
    } catch (err) {
      console.warn("[audio:native:isAvailable] tier probe", err);
      if (process.platform === "win32") return false;
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
      const tier = await resolveCaptureTier();
      if (tier === "rtaudio") {
        const devices = await listRtAudioDevices();
        if (devices.length > 0) return await withDeckLink(devices);
        console.warn("[audio:native:listDevices] rtaudio returned empty; using ffmpeg list");
      }
      if (tier === "swift") {
        const devices = await swiftHelper.listDevices();
        if (devices.length > 0) return await withDeckLink(toNativeDevices(devices));
        // Swift answered but with nothing — degrade for this call only.
        console.warn("[audio:native:listDevices] swift returned empty; using ffmpeg list");
      }
      return await withDeckLink(await listNativeDevices());
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
    if (typeof o.deviceIndex !== "number" || !Number.isInteger(o.deviceIndex) || o.deviceIndex < 0) {
      return { ok: false, error: "deviceIndex must be a non-negative integer" };
    }
    const cleanOpts = {
      deviceIndex: o.deviceIndex,
      channelFilter: typeof o.channelFilter === "string" ? o.channelFilter : undefined,
      sampleRate: typeof o.sampleRate === "number" ? o.sampleRate : undefined,
      channels: typeof o.channels === "number" ? o.channels : undefined,
    };
    // One capture at a time across ALL tiers — never two PCM streams.
    await stopAllCaptures();

    if (isDeckLinkIndex(cleanOpts.deviceIndex)) {
      return startRtAudioCapture({ deviceIndex: cleanOpts.deviceIndex, channelFilter: cleanOpts.channelFilter });
    }
    const captureTier = await resolveCaptureTier();
    if (captureTier === "rtaudio" && cleanOpts.deviceIndex >= API_INDEX_BASE) {
      const res = await startRtAudioCapture({
        deviceIndex: cleanOpts.deviceIndex,
        channelFilter: cleanOpts.channelFilter,
      });
      if (res.ok) return res;
      if (res.error === FRIENDLY_UNAVAILABLE) forceFfmpegTier("audify failed to load");
      return res; // busy / disappeared: operator-actionable, tier stays up
    }
    if (captureTier === "swift") {
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
    if (process.platform === "win32" && (captureTier !== "rtaudio" || cleanOpts.deviceIndex < API_INDEX_BASE)) {
      // Never start the unverified dshow path on Windows: fail loudly so the
      // renderer falls back to the proven browser/WASAPI capture.
      return { ok: false, error: FRIENDLY_UNAVAILABLE };
    }
    // ffmpeg tier, or a legacy (< API_INDEX_BASE) index while rtaudio is active.
    return nativeStartCapture(cleanOpts);
  });

  ipcMain.handle("audio:native:stopCapture", async () => {
    // Stop every tier — cheap no-ops on the inactive ones, and covers a
    // capture that started on another tier before a mid-session degrade.
    await stopAllCaptures();
    return { ok: true };
  });

  ipcMain.handle("audio:native:startChannelProbe", async (_e, opts: unknown) => {
    if (!opts || typeof opts !== "object") {
      return { ok: false, error: "invalid opts" };
    }
    const o = opts as StartProbeOpts;
    if (typeof o.deviceIndex !== "number" || !Number.isInteger(o.deviceIndex) || o.deviceIndex < 0 ||
        typeof o.channelCount !== "number") {
      return { ok: false, error: "deviceIndex and channelCount required" };
    }
    await stopAllProbes();
    if (isDeckLinkIndex(o.deviceIndex)) {
      return startRtAudioProbe({ deviceIndex: o.deviceIndex });
    }
    const probeTier = await resolveCaptureTier();
    if (probeTier === "rtaudio" && o.deviceIndex >= API_INDEX_BASE) {
      // Never degrade the tier from a probe: ASIO single-stream refusals while
      // listening are expected and reported to the operator.
      return startRtAudioProbe({ deviceIndex: o.deviceIndex });
    }
    if (probeTier === "swift") {
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
    await stopAllProbes();
    return { ok: true };
  });

  // Hardware I/O Phase B opt-in. `supported` = audify loads in this build;
  // `enabled` = operator switched the pro driver on (persisted in userData).
  ipcMain.handle("audio:native:getProDriver", async () => ({
    supported: await isRtAudioAvailable(),
    enabled: isProDriverEnabled(),
  }));
  ipcMain.handle("audio:native:setProDriver", async (_e, enabled: unknown) => {
    if (typeof enabled !== "boolean") return { ok: false, error: "enabled must be boolean" };
    // Switching tiers changes device indices — stop everything first; the
    // renderer restarts listening and re-resolves its device by name.
    await Promise.allSettled([stopAllCaptures(), stopAllProbes()]);
    setProDriverEnabled(enabled);
    return { ok: true, enabled: isProDriverEnabled() };
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
    stopRtAudioCapture(),
    stopRtAudioProbe(),
    swiftHelper.shutdown(),
  ]);
  shutdownRtAudioWorker();
}
