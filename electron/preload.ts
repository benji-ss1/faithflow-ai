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
