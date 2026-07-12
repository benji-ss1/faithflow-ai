import { ipcMain, screen, app } from "electron";
import * as path from "path";
import * as fs from "fs";
import { createOutputWindow, closeOutputWindow, closeAll, OutputRole, Preset, LivestreamObsMode } from "../windows/OutputWindow";

// Y5: Persist role assignments to disk (userData/screens-assignments.json)
// so an operator's Stage/Projector/Livestream mapping survives an app
// restart. In-memory Map is still the hot path; disk is written through on
// assign/close. Plain JSON, no new dep.
type StoredAssignment = { displayId: number; preset: Preset; obsMode?: LivestreamObsMode };
const ASSIGNMENTS_FILE = "screens-assignments.json";
function assignmentsPath(): string {
  try { return path.join(app.getPath("userData"), ASSIGNMENTS_FILE); } catch { return ""; }
}
const VALID_ROLES_SET: ReadonlySet<OutputRole> = new Set<OutputRole>(["Projector", "Stage", "Livestream"]);
const VALID_PRESETS_SET: ReadonlySet<Preset> = new Set<Preset>(["720p", "1080p30", "1080p60", "4K"]);
const VALID_OBS_MODES_SET: ReadonlySet<LivestreamObsMode> = new Set<LivestreamObsMode>(["full", "lowerthird"]);
function loadAssignments(): Map<OutputRole, StoredAssignment> {
  const map = new Map<OutputRole, StoredAssignment>();
  const p = assignmentsPath();
  if (!p) return map;
  try {
    if (!fs.existsSync(p)) return map;
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return map;
    for (const [role, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!VALID_ROLES_SET.has(role as OutputRole)) continue;
      if (!v || typeof v !== "object") continue;
      const rec = v as Record<string, unknown>;
      if (typeof rec.displayId !== "number" || !Number.isFinite(rec.displayId)) continue;
      if (typeof rec.preset !== "string" || !VALID_PRESETS_SET.has(rec.preset as Preset)) continue;
      const stored: StoredAssignment = { displayId: rec.displayId, preset: rec.preset as Preset };
      if (typeof rec.obsMode === "string" && VALID_OBS_MODES_SET.has(rec.obsMode as LivestreamObsMode)) {
        stored.obsMode = rec.obsMode as LivestreamObsMode;
      }
      map.set(role as OutputRole, stored);
    }
  } catch (e) {
    console.warn("[screens] failed to load assignments:", e instanceof Error ? e.message : String(e));
  }
  return map;
}
function saveAssignments(map: Map<OutputRole, StoredAssignment>) {
  const p = assignmentsPath();
  if (!p) return;
  try {
    const obj: Record<string, StoredAssignment> = {};
    for (const [role, v] of map.entries()) obj[role] = v;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
  } catch (e) {
    console.warn("[screens] failed to save assignments:", e instanceof Error ? e.message : String(e));
  }
}

// Lazy: load on first access so tests / non-Electron require don't hit
// `app.getPath` before `app.whenReady`.
let roleAssignments: Map<OutputRole, StoredAssignment> | null = null;
function getRoleAssignments(): Map<OutputRole, StoredAssignment> {
  if (!roleAssignments) roleAssignments = loadAssignments();
  return roleAssignments;
}
const VALID_OBS_MODES: ReadonlySet<LivestreamObsMode> = new Set(["full", "lowerthird"]);
function isValidObsMode(m: unknown): m is LivestreamObsMode {
  return typeof m === "string" && (VALID_OBS_MODES as ReadonlySet<string>).has(m);
}

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

  ipcMain.handle("screens:assign", (_e, { displayId, role, presetOrResolution, obsMode }) => {
    if (!isValidRole(role)) return { ok: false, error: "invalid role" };
    if (typeof displayId !== "number" || !Number.isFinite(displayId)) return { ok: false, error: "invalid displayId" };
    const preset: Preset = isValidPreset(presetOrResolution) ? presetOrResolution : "1080p30";
    // If a preset was supplied but invalid, reject rather than silently
    // defaulting — this is a security-sensitive input surface.
    if (presetOrResolution !== undefined && presetOrResolution !== null && !isValidPreset(presetOrResolution)) {
      return { ok: false, error: "invalid preset" };
    }
    let obs: LivestreamObsMode | undefined;
    if (obsMode !== undefined && obsMode !== null) {
      if (!isValidObsMode(obsMode)) return { ok: false, error: "invalid obsMode" };
      obs = obsMode;
    }
    const map = getRoleAssignments();
    map.set(role, { displayId, preset, obsMode: obs });
    saveAssignments(map);
    return { ok: true };
  });

  ipcMain.handle("screens:spawn", (_e, { role }) => {
    if (!isValidRole(role)) return { ok: false, error: "invalid role" };
    const assignment = getRoleAssignments().get(role);
    const displays = screen.getAllDisplays();
    // Fall back to first non-primary display, or primary if only one screen
    const targetDisplay =
      (assignment && displays.find((d) => d.id === assignment.displayId)) ||
      displays.find((d) => d.id !== screen.getPrimaryDisplay().id) ||
      screen.getPrimaryDisplay();
    const preset: Preset = assignment?.preset ?? "1080p30";
    createOutputWindow(role, targetDisplay, preset, getAppUrl(), { obsMode: assignment?.obsMode });
    return { ok: true, displayId: targetDisplay.id, preset };
  });

  ipcMain.handle("screens:close", (_e, { role }) => {
    if (!isValidRole(role)) return { ok: false, error: "invalid role" };
    closeOutputWindow(role);
    // Y5: closing a role window drops its persisted assignment so a stale
    // mapping doesn't reopen on next launch.
    const map = getRoleAssignments();
    if (map.delete(role)) saveAssignments(map);
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
