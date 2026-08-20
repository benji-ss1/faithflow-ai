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
  return withSettings(findAny(id) ?? NONE_BACKGROUND);
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

// ── Custom uploads (Phase 3/5) ───────────────────────────────────────────────
// The operator's own image/video backgrounds. Stored as full PFBackground entries
// (with an https imageUrl/videoUrl from the media upload flow) so the projector
// window can load them.
const CUSTOM_KEY = "presentflow.backgrounds.custom.v1";

export function readCustomBackgrounds(): PFBackground[] {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as PFBackground[]).filter((b) => b && typeof b.id === "string") : [];
  } catch {
    return [];
  }
}

export function addCustomBackground(bg: PFBackground): void {
  if (!isBrowser()) return;
  try {
    const all = readCustomBackgrounds().filter((b) => b.id !== bg.id);
    all.unshift(bg);
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(all.slice(0, 60)));
  } catch {
    /* ignore */
  }
  try { window.dispatchEvent(new CustomEvent(BACKGROUND_CHANGED_EVENT, { detail: { id: bg.id } })); } catch { /* ignore */ }
}

export function removeCustomBackground(id: string): void {
  if (!isBrowser()) return;
  try {
    const all = readCustomBackgrounds().filter((b) => b.id !== id);
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(all));
    // If the deleted one was active, fall back to None.
    if (readActiveBackgroundId() === id) setActiveBackgroundId("none");
  } catch {
    /* ignore */
  }
  try { window.dispatchEvent(new CustomEvent(BACKGROUND_CHANGED_EVENT, { detail: { id } })); } catch { /* ignore */ }
}

function findAny(id: string): PFBackground | undefined {
  return findBuiltIn(id) ?? readCustomBackgrounds().find((b) => b.id === id);
}

export function listBackgrounds(): PFBackground[] {
  return [...BUILT_IN_BACKGROUNDS, ...readCustomBackgrounds()];
}
