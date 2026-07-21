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
