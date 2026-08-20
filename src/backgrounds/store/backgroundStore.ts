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

export function readActiveBackground(): PFBackground {
  const id = readActiveBackgroundId();
  return findBuiltIn(id) ?? NONE_BACKGROUND;
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
