import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";

type Handler = (...args: any[]) => void;
const listeners = new Map<Handler, (event: IpcRendererEvent, ...args: any[]) => void>();

const api = {
  screens: {
    list: () => ipcRenderer.invoke("screens:list"),
    assign: (displayId: number, role: string, presetOrResolution: string) =>
      ipcRenderer.invoke("screens:assign", { displayId, role, presetOrResolution }),
    spawn: (role: string) => ipcRenderer.invoke("screens:spawn", { role }),
    close: (role: string) => ipcRenderer.invoke("screens:close", { role }),
  },
  audio: {
    listInputs: () => ipcRenderer.invoke("audio:listInputs"),
    listSystemSources: () => ipcRenderer.invoke("audio:listSystemSources"),
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
