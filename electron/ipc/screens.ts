import { ipcMain, screen } from "electron";
import { createOutputWindow, closeOutputWindow, closeAll, OutputRole, Preset } from "../windows/OutputWindow";

// Track last-known assignments in-memory so 'spawn' without prior 'assign' still works.
const roleAssignments = new Map<OutputRole, { displayId: number; preset: Preset }>();

// S2: whitelist role + preset unions. Reject anything else — renderer
// callers must not be able to spawn an arbitrary role string or a preset
// that OutputWindow doesn't know how to size. Kept in sync with the type
// unions in electron/windows/OutputWindow.ts.
const VALID_ROLES: ReadonlySet<OutputRole> = new Set(["Projector", "Stage", "Livestream"]);
const VALID_PRESETS: ReadonlySet<Preset> = new Set(["720p", "1080p30", "1080p60", "4K"]);
function isValidRole(r: unknown): r is OutputRole {
  return typeof r === "string" && (VALID_ROLES as ReadonlySet<string>).has(r);
}
function isValidPreset(p: unknown): p is Preset {
  return typeof p === "string" && (VALID_PRESETS as ReadonlySet<string>).has(p);
}

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
    if (!isValidRole(role)) return { ok: false, error: "invalid role" };
    if (typeof displayId !== "number" || !Number.isFinite(displayId)) return { ok: false, error: "invalid displayId" };
    const preset: Preset = isValidPreset(presetOrResolution) ? presetOrResolution : "1080p30";
    // If a preset was supplied but invalid, reject rather than silently
    // defaulting — this is a security-sensitive input surface.
    if (presetOrResolution !== undefined && presetOrResolution !== null && !isValidPreset(presetOrResolution)) {
      return { ok: false, error: "invalid preset" };
    }
    roleAssignments.set(role, { displayId, preset });
    return { ok: true };
  });

  ipcMain.handle("screens:spawn", (_e, { role }) => {
    if (!isValidRole(role)) return { ok: false, error: "invalid role" };
    const assignment = roleAssignments.get(role);
    const displays = screen.getAllDisplays();
    // Fall back to first non-primary display, or primary if only one screen
    const targetDisplay =
      (assignment && displays.find((d) => d.id === assignment.displayId)) ||
      displays.find((d) => d.id !== screen.getPrimaryDisplay().id) ||
      screen.getPrimaryDisplay();
    const preset: Preset = assignment?.preset ?? "1080p30";
    createOutputWindow(role, targetDisplay, preset, getAppUrl());
    return { ok: true, displayId: targetDisplay.id, preset };
  });

  ipcMain.handle("screens:close", (_e, { role }) => {
    if (!isValidRole(role)) return { ok: false, error: "invalid role" };
    closeOutputWindow(role);
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
