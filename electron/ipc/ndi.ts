// NDI IPC bridge (Phase 2). UNVERIFIED — needs the app running + native addon.
//
// Registers the main-process handlers the Settings→Output→NDI UI (§17) calls,
// owns the single NDIService instance, and persists settings to userData so NDI
// auto-starts on the next launch when enabled (§2). Mirrors the structure of the
// other electron/ipc/* modules; keep NDI networking OUT of the renderer (§24).

import { ipcMain, app } from "electron";
import * as path from "path";
import * as fs from "fs";
import { NDIService, NDI_DEFAULTS, type NdiSettings } from "../ndi/NDIService";

let service: NDIService | null = null;

function settingsPath(): string {
  return path.join(app.getPath("userData"), "ndi-settings.json");
}
function loadSettings(): NdiSettings {
  try {
    const raw = fs.readFileSync(settingsPath(), "utf8");
    const p = JSON.parse(raw) as Partial<NdiSettings>;
    return sanitize(p);
  } catch { return { ...NDI_DEFAULTS }; }
}
function saveSettings(s: NdiSettings) {
  try { fs.writeFileSync(settingsPath(), JSON.stringify(s), "utf8"); } catch { /* ignore */ }
}
// Validate/clamp so a tampered file can't drive bad values into the native layer.
function sanitize(p: Partial<NdiSettings>): NdiSettings {
  const s = { ...NDI_DEFAULTS };
  if (typeof p.enabled === "boolean") s.enabled = p.enabled;
  if (typeof p.sourceName === "string" && p.sourceName.trim() && p.sourceName.length <= 128) s.sourceName = p.sourceName.trim();
  if (p.mode === "transparent" || p.mode === "full") s.mode = p.mode;
  if ([1280, 1920, 3840].includes(p.width as number)) s.width = p.width as number;
  if ([720, 1080, 2160].includes(p.height as number)) s.height = p.height as number;
  if ([30, 60].includes(p.fps as number)) s.fps = p.fps as number;
  if (typeof p.audio === "boolean") s.audio = p.audio;
  // Keep resolution pairs consistent.
  if (s.width === 1280) s.height = 720; else if (s.width === 3840) s.height = 2160; else { s.width = 1920; s.height = 1080; }
  return s;
}

/**
 * Call once from main.ts after `appUrl` is resolved.
 * Auto-starts NDI if the persisted settings have it enabled (§2).
 */
export function registerNdiIpc(appUrl: string) {
  const settings = loadSettings();
  service = new NDIService(appUrl);
  service.initialize(settings);

  ipcMain.handle("ndi:get-settings", () => service!.getSettings());
  ipcMain.handle("ndi:get-status", () => service!.getStatus());

  ipcMain.handle("ndi:set-settings", async (_e, patch: Partial<NdiSettings>) => {
    const prev = service!.getSettings();
    const merged = sanitize({ ...prev, ...(patch || {}) });
    service!.initialize(merged);
    saveSettings(merged);
    if (merged.enabled && !service!.getStatus().broadcasting) {
      await service!.start();
    } else if (!merged.enabled && service!.getStatus().broadcasting) {
      service!.stop();
    } else if (service!.getStatus().broadcasting) {
      // Coalesce into ONE restart only if a create-time field (source name /
      // resolution / fps) changed — otherwise a mode change is a cheap URL reload.
      // Previously this fired three separate restarts per save (LAN flicker).
      const createChanged =
        merged.sourceName !== prev.sourceName ||
        merged.width !== prev.width ||
        merged.height !== prev.height ||
        merged.fps !== prev.fps;
      if (createChanged) service!.restart();
      else if (merged.mode !== prev.mode) service!.setOutputMode(merged.mode);
    }
    return service!.getStatus();
  });

  ipcMain.handle("ndi:start", async () => { const s = await service!.start(); saveSettings({ ...service!.getSettings(), enabled: true }); return s; });
  ipcMain.handle("ndi:stop", () => { service!.stop(); saveSettings({ ...service!.getSettings(), enabled: false }); return service!.getStatus(); });
  ipcMain.handle("ndi:test", (_e, on: boolean) => { service!.showTestPattern(!!on); return service!.getStatus(); });

  // Auto-start on launch if enabled.
  if (settings.enabled) { void service.start(); }

  app.on("before-quit", () => { try { service?.shutdown(); } catch { /* ignore */ } });
}
