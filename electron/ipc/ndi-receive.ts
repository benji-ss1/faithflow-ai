// NDI AUDIO RECEIVE IPC bridge. Registers the handlers the Audio tab's NDI
// source picker calls, owns the single NDIReceiveService, and pushes PCM/level to
// the renderer (ndiAudio:pcm / ndiAudio:level). NDI networking stays in main.
//
// UNVERIFIED — needs the native addon compiled + the app running.

import { ipcMain, app, BrowserWindow } from "electron";
import { NDIReceiveService } from "../ndi/NDIReceiveService";

let service: NDIReceiveService | null = null;

/** Call once from main.ts after the main window getter is available. */
export function registerNdiReceiveIpc(getMainWindow: () => BrowserWindow | null) {
  service = new NDIReceiveService(getMainWindow);

  ipcMain.handle("ndiAudio:list-sources", () => {
    try { return service!.listSources(); } catch { return []; }
  });
  ipcMain.handle("ndiAudio:get-status", () => service!.getStatus());
  ipcMain.handle("ndiAudio:start", async (_e, sourceName: unknown) => {
    if (typeof sourceName !== "string" || !sourceName.trim() || sourceName.length > 256) {
      return { ok: false, error: "invalid source name" };
    }
    return service!.start(sourceName.trim());
  });
  ipcMain.handle("ndiAudio:stop", () => { service!.stop(); return service!.getStatus(); });

  app.on("before-quit", () => { try { service?.shutdown(); } catch { /* ignore */ } });
}
