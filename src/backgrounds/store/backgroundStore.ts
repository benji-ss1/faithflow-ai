// Background Templates — persistence. Stores ONLY the active background id +
// (later) custom uploads, in a SEPARATE localStorage key from the theme system.
// Fires a change event the operator console + selector listen to.
import { BUILT_IN_BACKGROUNDS, NONE_BACKGROUND, findBuiltIn } from "../presets/defaultTemplates";
import type { PFBackground } from "../models/BackgroundTypes";

const ACTIVE_KEY = "presentflow.backgrounds.activeId.v1";
export const BACKGROUND_CHANGED_EVENT = "presentflow:background-changed";

function isBrowser() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function readActiveBackgroundId(): string {
  if (!isBrowser()) return "none";
  try {
    return localStorage.getItem(ACTIVE_KEY) || "none";
  } catch {
    return "none";
  }
}

// Per-template SETTINGS overrides (speed/intensity/colours/overlay), keyed by
// background id. Kept separate from the preset defaults so the operator can
// customise a built-in without editing code, and reset to default any time.
const SETTINGS_KEY = "presentflow.backgrounds.settings.v1";
export type BackgroundSettings = Partial<Pick<PFBackground,
  "shaderSpeed" | "shaderIntensity" | "shaderPrimaryColor" | "shaderSecondaryColor" |
  "overlayColor" | "overlayOpacity" | "imageBlur" | "imageFit" | "videoPlaybackSpeed">>;

function readAllSettings(): Record<string, BackgroundSettings> {
  if (!isBrowser()) return {};
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function readSettings(id: string): BackgroundSettings {
  return readAllSettings()[id] ?? {};
}

export function writeSettings(id: string, patch: BackgroundSettings): void {
  if (!isBrowser()) return;
  try {
    const all = readAllSettings();
    all[id] = { ...(all[id] ?? {}), ...patch };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent(BACKGROUND_CHANGED_EVENT, { detail: { id } }));
  } catch {
    /* ignore */
  }
}

export function resetSettings(id: string): void {
  if (!isBrowser()) return;
  try {
    const all = readAllSettings();
    delete all[id];
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent(BACKGROUND_CHANGED_EVENT, { detail: { id } }));
  } catch {
    /* ignore */
  }
}

/** A built-in merged with any operator settings override. */
export function withSettings(bg: PFBackground): PFBackground {
  const s = readSettings(bg.id);
  return { ...bg, ...s };
}

export function readActiveBackground(): PFBackground {
  const id = readActiveBackgroundId();
  return withSettings(findBuiltIn(id) ?? NONE_BACKGROUND);
}

export function setActiveBackgroundId(id: string): void {
  if (!isBrowser()) return;
  const known = findBuiltIn(id) ? id : "none";
  try {
    localStorage.setItem(ACTIVE_KEY, known);
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent(BACKGROUND_CHANGED_EVENT, { detail: { id: known } }));
  } catch {
    /* ignore */
  }
}

export function listBackgrounds(): PFBackground[] {
  // Built-ins for now; custom uploads (Phase 3/5) will be merged here.
  return BUILT_IN_BACKGROUNDS;
}
