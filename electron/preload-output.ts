// Minimal, LEAST-PRIVILEGE preload for OUTPUT windows (/live, /stage,
// /livestream). It exposes ONLY the same-machine live-sync RELAY (`pf:live`) as
// `window.electronAPI.live`, nothing else — no audio, NDI, dialog, fs, or update
// surface. (The main window's full preload is deliberately NOT used here.)
//
// Why this exists: BroadcastChannel is unreliable ACROSS separate Electron
// BrowserWindows (operator ↔ projector). The projector's slides ride frequent
// messages so they get through, but the THEME/background/appearance ride only a
// rare, deduped "output" message — a single drop left the projector unthemed for
// the whole service with no recovery (2026-08-28 field bug: yellow lyrics on a
// white projector). Giving the output window this relay listener means it
// receives operator state over the reliable main-process fan-out, alongside
// BroadcastChannel (duplicates are deduped by message id in broadcast.ts).
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

const api = {
  live: {
    post: (msg: unknown) => ipcRenderer.send("pf:live", msg),
    onMessage: (cb: (msg: unknown) => void) => {
      const handler = (_e: IpcRendererEvent, msg: unknown) => cb(msg);
      ipcRenderer.on("pf:live", handler);
      return () => ipcRenderer.removeListener("pf:live", handler);
    },
  },
};

contextBridge.exposeInMainWorld("electronAPI", api);
