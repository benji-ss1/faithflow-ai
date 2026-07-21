import { ipcMain, desktopCapturer, systemPreferences } from "electron";

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
