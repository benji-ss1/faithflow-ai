import { ipcMain, screen } from "electron";
import { createOutputWindow, closeOutputWindow, closeAll, OutputRole, Preset } from "../windows/OutputWindow";

// Track last-known assignments in-memory so 'spawn' without prior 'assign' still works.
const roleAssignments = new Map<OutputRole, { displayId: number; preset: Preset }>();

export function registerScreenIpc(getAppUrl: () => string) {
  ipcMain.handle("screens:list", () => {
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay().id;
    return displays.map((d) => ({
      id: d.id,
      label: d.label || `Display ${d.id}`,
      bounds: d.bounds,
      workArea: d.workArea,
      size: d.size,
      scaleFactor: d.scaleFactor,
      rotation: d.rotation,
      internal: (d as any).internal ?? false,
      isPrimary: d.id === primary,
    }));
  });

  ipcMain.handle("screens:assign", (_e, { displayId, role, presetOrResolution }) => {
    roleAssignments.set(role as OutputRole, {
      displayId,
      preset: (presetOrResolution as Preset) || "1080p30",
    });
    return { ok: true };
  });

  ipcMain.handle("screens:spawn", (_e, { role }) => {
    const assignment = roleAssignments.get(role as OutputRole);
    const displays = screen.getAllDisplays();
    // Fall back to first non-primary display, or primary if only one screen
    const targetDisplay =
      (assignment && displays.find((d) => d.id === assignment.displayId)) ||
      displays.find((d) => d.id !== screen.getPrimaryDisplay().id) ||
      screen.getPrimaryDisplay();
    const preset: Preset = assignment?.preset ?? "1080p30";
    createOutputWindow(role as OutputRole, targetDisplay, preset, getAppUrl());
    return { ok: true, displayId: targetDisplay.id, preset };
  });

  ipcMain.handle("screens:close", (_e, { role }) => {
    closeOutputWindow(role as OutputRole);
    return { ok: true };
  });
}

export function closeAllOutputWindows() {
  closeAll();
}

export function openOutputForRole(role: OutputRole) {
  // programmatic helper used by main
  const displays = screen.getAllDisplays();
  const target = displays.find((d) => d.id !== screen.getPrimaryDisplay().id) || screen.getPrimaryDisplay();
  // no appUrl here; caller in main.ts wires it — this helper is a stub
  return { role, displayId: target.id };
}
