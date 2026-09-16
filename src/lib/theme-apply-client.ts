"use client";
/**
 * Apply a church theme from the operator (Themes tab + ProPresenter-style Theme
 * popover share this one path). Sets it as the church default, pushes the look
 * to the live outputs, restyles the current song, and records it in Recents.
 */
import { toast } from "sonner";

export type ClientTheme = { id: string; name: string; config: Record<string, unknown>; isDefault?: boolean };

const RECENTS_KEY = "presentflow.themeRecents.v1";
const RECENTS_MAX = 6;

export function readThemeRecents(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, RECENTS_MAX) : [];
  } catch {
    return [];
  }
}

export function pushThemeRecent(id: string): void {
  try {
    const next = [id, ...readThemeRecents().filter((x) => x !== id)].slice(0, RECENTS_MAX);
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("presentflow:theme-recents-changed"));
  } catch { /* storage unavailable */ }
}

/** Returns true when the theme was applied. */
export async function applyThemeLive(t: ClientTheme): Promise<boolean> {
  try {
    const res = await fetch(`/api/themes/${t.id}/apply`, { method: "POST" });
    if (!res.ok) {
      toast.error("Could not apply theme");
      return false;
    }
    // Drive the live output immediately (same-machine, like font-scale) so the
    // projector/stage/livestream reflect the applied theme without a refetch.
    // OperatorConsole listens for this and emits it on OutputState.
    const { themeConfigToAppearance } = await import("@/lib/theme-appearance");
    window.dispatchEvent(new CustomEvent("presentflow:theme-changed", {
      detail: { appearance: themeConfigToAppearance(t.config) },
    }));
    // ALSO restyle the whole current song — every slide/preview, not just the
    // live screen (user directive). PlaylistSection (which knows the current
    // song + can refresh + offer undo) handles this.
    window.dispatchEvent(new CustomEvent("presentflow:apply-theme-to-song", {
      detail: { themeId: t.id, themeName: t.name },
    }));
    pushThemeRecent(t.id);
    toast.success(`Theme "${t.name}" applied`);
    return true;
  } catch {
    toast.error("Could not apply theme");
    return false;
  }
}
