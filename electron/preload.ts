import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";

type Handler = (...args: any[]) => void;
const listeners = new Map<Handler, (event: IpcRendererEvent, ...args: any[]) => void>();

const api = {
  screens: {
    list: () => ipcRenderer.invoke("screens:list"),
    assign: (displayId: number, role: string, presetOrResolution: string, obsMode?: string) =>
      ipcRenderer.invoke("screens:assign", { displayId, role, presetOrResolution, obsMode }),
    spawn: (role: string) => ipcRenderer.invoke("screens:spawn", { role }),
    close: (role: string) => ipcRenderer.invoke("screens:close", { role }),
  },
  audio: {
    listInputs: () => ipcRenderer.invoke("audio:listInputs"),
    listSystemSources: () => ipcRenderer.invoke("audio:listSystemSources"),
    getMicPermissionStatus: () => ipcRenderer.invoke("audio:getMicPermissionStatus"),
    // Wave 1: native ffmpeg-backed audio capture. Bypasses Chromium's
    // getUserMedia (which silently drops 32-channel USB pro-audio input,
    // confirmed at JPD field test) and pipes CoreAudio/DirectShow PCM
    // straight from a main-process ffmpeg subprocess. Renderers check
    // isAvailable() first and fall back to the legacy handlers above
    // when it returns false (Linux, missing binary, etc.).
    native: {
      isAvailable: (): Promise<boolean> =>
        ipcRenderer.invoke("audio:native:isAvailable"),
      listDevices: (): Promise<Array<{
        index: number;
        name: string;
        platform: "darwin" | "win32" | "linux";
        channelCount?: number;
        sampleRate?: number;
      }>> => ipcRenderer.invoke("audio:native:listDevices"),
      startCapture: (opts: {
        deviceIndex: number;
        channelFilter?: string;
        sampleRate?: number;
        channels?: number;
      }): Promise<{ ok: boolean; error?: string }> =>
        ipcRenderer.invoke("audio:native:startCapture", opts),
      stopCapture: (): Promise<void> =>
        ipcRenderer.invoke("audio:native:stopCapture"),
      // PCM chunk subscription — the renderer is expected to forward these
      // bytes directly into the Deepgram WebSocket. Chunks arrive as
      // ArrayBuffer (structured-cloned across the IPC boundary).
      onPcmChunk: (cb: (chunk: ArrayBuffer) => void) => {
        const handler = (_e: IpcRendererEvent, chunk: ArrayBuffer) => cb(chunk);
        ipcRenderer.on("audio:nativePcmChunk", handler);
        return () => ipcRenderer.removeListener("audio:nativePcmChunk", handler);
      },
      onLevel: (cb: (level: { rms: number; db: number; peak: number }) => void) => {
        const handler = (_e: IpcRendererEvent, level: { rms: number; db: number; peak: number }) => cb(level);
        ipcRenderer.on("audio:nativeLevel", handler);
        return () => ipcRenderer.removeListener("audio:nativeLevel", handler);
      },
      onError: (cb: (err: { message: string; suggestion?: string }) => void) => {
        const handler = (_e: IpcRendererEvent, err: { message: string; suggestion?: string }) => cb(err);
        ipcRenderer.on("audio:nativeError", handler);
        return () => ipcRenderer.removeListener("audio:nativeError", handler);
      },
      startChannelProbe: (opts: {
        deviceIndex: number;
        channelCount: number;
      }): Promise<{ ok: boolean; error?: string }> =>
        ipcRenderer.invoke("audio:native:startChannelProbe", opts),
      stopChannelProbe: (): Promise<void> =>
        ipcRenderer.invoke("audio:native:stopChannelProbe"),
      onChannelLevels: (cb: (levels: Array<{ channel: number; rms: number; db: number; peak: number }>) => void) => {
        const handler = (_e: IpcRendererEvent, levels: Array<{ channel: number; rms: number; db: number; peak: number }>) => cb(levels);
        ipcRenderer.on("audio:nativeChannelLevels", handler);
        return () => ipcRenderer.removeListener("audio:nativeChannelLevels", handler);
      },
    },
  },
  dialog: {
    openFile: (options: any) => ipcRenderer.invoke("dialog:openFile", options),
    openDirectory: () => ipcRenderer.invoke("dialog:openDirectory"),
    showMessage: (options: any) => ipcRenderer.invoke("dialog:showMessage", options),
  },
  fs: {
    readDirRecursive: (dirPath: string, extensions: string[]) =>
      ipcRenderer.invoke("fs:readDirRecursive", { dirPath, extensions }),
    readFile: (filePath: string) => ipcRenderer.invoke("fs:readFile", { filePath }),
  },
  app: {
    version: () => ipcRenderer.invoke("app:version"),
    platform: () => ipcRenderer.invoke("app:platform"),
  },
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke("shell:openExternal", url),
  },
  license: {
    get: () => ipcRenderer.invoke("license:get"),
    set: (key: string) => ipcRenderer.invoke("license:set", key),
    clear: () => ipcRenderer.invoke("license:clear"),
  },
  update: {
    onAvailable: (cb: (info: { version: string; releaseDate: string }) => void) => {
      const handler = (_e: IpcRendererEvent, info: { version: string; releaseDate: string }) => cb(info);
      ipcRenderer.on("update:available", handler);
      return () => ipcRenderer.removeListener("update:available", handler);
    },
    onDownloaded: (cb: (info: { version: string }) => void) => {
      const handler = (_e: IpcRendererEvent, info: { version: string }) => cb(info);
      ipcRenderer.on("update:downloaded", handler);
      return () => ipcRenderer.removeListener("update:downloaded", handler);
    },
    onError: (cb: (info: { message: string }) => void) => {
      const handler = (_e: IpcRendererEvent, info: { message: string }) => cb(info);
      ipcRenderer.on("update:error", handler);
      return () => ipcRenderer.removeListener("update:error", handler);
    },
    installNow: () => ipcRenderer.invoke("update:install-now"),
    retryDownload: () => ipcRenderer.invoke("update:retry-download"),
  },
  // 2026-08-16 — same-machine live-sync RELAY. BroadcastChannel was proving
  // unreliable across separate Electron BrowserWindows (operator ↔ projector),
  // leaving the projector stuck ("Operator disconnected") and not picking up
  // e.g. a translation switch. This bridges every LiveMessage through the main
  // process, which fans it out to all OTHER windows — a delivery path that does
  // not depend on BroadcastChannel. The renderer uses it ALONGSIDE
  // BroadcastChannel (belt-and-braces); duplicates are deduped by message id.
  live: {
    post: (msg: unknown) => ipcRenderer.send("pf:live", msg),
    onMessage: (cb: (msg: unknown) => void) => {
      const handler = (_e: IpcRendererEvent, msg: unknown) => cb(msg);
      ipcRenderer.on("pf:live", handler);
      return () => ipcRenderer.removeListener("pf:live", handler);
    },
  },
  // NDI output control for the Settings→Output→NDI panel (spec §17).
  ndi: {
    getSettings: () => ipcRenderer.invoke("ndi:get-settings"),
    getStatus: () => ipcRenderer.invoke("ndi:get-status"),
    setSettings: (patch: unknown) => ipcRenderer.invoke("ndi:set-settings", patch),
    start: () => ipcRenderer.invoke("ndi:start"),
    stop: () => ipcRenderer.invoke("ndi:stop"),
    test: (on: boolean) => ipcRenderer.invoke("ndi:test", on),
  },
  // NDI AUDIO RECEIVE — discover/select an NDI source and stream its audio into
  // the AI pipeline as if it were a USB device (no cable to the mixer needed).
  // PCM arrives 16 kHz mono int16 as an ArrayBuffer; the renderer forwards it into
  // the SAME onPcmChunk → Deepgram WebSocket path as the native audio bridge.
  ndiAudio: {
    listSources: (): Promise<Array<{ name: string; urlAddress: string }>> =>
      ipcRenderer.invoke("ndiAudio:list-sources"),
    getStatus: (): Promise<{ available: boolean; connected: boolean; sourceName: string | null; error: string | null }> =>
      ipcRenderer.invoke("ndiAudio:get-status"),
    startReceive: (sourceName: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke("ndiAudio:start", sourceName),
    stopReceive: (): Promise<unknown> => ipcRenderer.invoke("ndiAudio:stop"),
    onPcmChunk: (cb: (chunk: ArrayBuffer) => void) => {
      const handler = (_e: IpcRendererEvent, chunk: ArrayBuffer) => cb(chunk);
      ipcRenderer.on("ndiAudio:pcm", handler);
      return () => ipcRenderer.removeListener("ndiAudio:pcm", handler);
    },
    onLevel: (cb: (level: { rms: number; db: number; peak: number }) => void) => {
      const handler = (_e: IpcRendererEvent, level: { rms: number; db: number; peak: number }) => cb(level);
      ipcRenderer.on("ndiAudio:level", handler);
      return () => ipcRenderer.removeListener("ndiAudio:level", handler);
    },
    onError: (cb: (err: { message: string; suggestion?: string }) => void) => {
      const handler = (_e: IpcRendererEvent, err: { message: string; suggestion?: string }) => cb(err);
      ipcRenderer.on("ndiAudio:error", handler);
      return () => ipcRenderer.removeListener("ndiAudio:error", handler);
    },
  },
  // LAN OVERLAY — run a local http+ws server so an OBS Browser Source on a
  // SEPARATE broadcast PC receives lyrics over the local network, no cloud
  // dependency. `publish` is fire-and-forget on the hot output path.
  lan: {
    start: (port?: number): Promise<{ running: boolean; ip: string | null; port: number | null; clients: number }> =>
      ipcRenderer.invoke("lan:start", port),
    stop: (): Promise<{ running: boolean; ip: string | null; port: number | null; clients: number }> =>
      ipcRenderer.invoke("lan:stop"),
    status: (): Promise<{ running: boolean; ip: string | null; port: number | null; clients: number }> =>
      ipcRenderer.invoke("lan:status"),
    publish: (state: unknown) => ipcRenderer.send("lan:publish", state),
  },
  on: (channel: string, handler: Handler) => {
    const wrapped = (_e: IpcRendererEvent, ...args: any[]) => handler(...args);
    listeners.set(handler, wrapped);
    ipcRenderer.on(channel, wrapped);
  },
  off: (channel: string, handler: Handler) => {
    const wrapped = listeners.get(handler);
    if (wrapped) {
      ipcRenderer.removeListener(channel, wrapped);
      listeners.delete(handler);
    }
  },
};

contextBridge.exposeInMainWorld("electronAPI", api);

export type ElectronAPI = typeof api;
