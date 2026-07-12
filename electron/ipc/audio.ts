import { ipcMain, desktopCapturer } from "electron";

export function registerAudioIpc() {
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
