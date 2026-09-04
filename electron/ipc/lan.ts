// LAN overlay IPC bridge. Lets the operator renderer start/stop the LAN overlay
// server (Screens panel) and forward every OutputState frame to it, so an OBS
// Browser Source on a separate broadcast PC receives lyrics over the local
// network with no cloud dependency. See electron/lan/LanOverlayServer.ts.

import { ipcMain, app } from "electron";
import { getLanServer } from "../lan/LanOverlayServer";

export function registerLanIpc(getAppUrl: () => string) {
  const server = getLanServer();

  ipcMain.handle("lan:start", async (_e, port: unknown) => {
    const p = typeof port === "number" && Number.isFinite(port) ? port : undefined;
    return server.start(getAppUrl(), p);
  });
  ipcMain.handle("lan:stop", async () => { await server.stop(); return server.info(); });
  ipcMain.handle("lan:status", () => server.info());
  // Fire-and-forget publish on every output change. `send` (not `invoke`) so the
  // renderer's hot output path never blocks on a round-trip.
  ipcMain.on("lan:publish", (_e, state: unknown) => {
    try { server.publish(state); } catch { /* ignore */ }
  });

  app.on("before-quit", () => { void server.stop().catch(() => {}); });
}
