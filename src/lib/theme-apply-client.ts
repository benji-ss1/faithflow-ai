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

/**
 * A theme that carries its OWN background and a Background Template are mutually
 * exclusive on the projector (user-approved 2026-08-28). `applyThemeLive` gets
 * this right because it dispatches `presentflow:theme-changed`, whose handler in
 * OperatorConsole clears the template and stamps the theme as the newest pick.
 *
 * The PER-SONG apply paths (the slide-grid Theme menu, the apply-theme-to-song
 * listener) did NOT, so an already-active template kept out-ranking the theme and
 * the operator saw "Theme applied" while the background never changed — field
 * report 2026-09-22.
 *
 * Returns the prior background state when it cleared one, so the caller's Undo
 * can put the operator's template back exactly as it was; null when there was
 * nothing to do (a text-only theme leaves any template alone, so the two can
 * still be layered).
 */
export async function syncBackgroundForAppliedTheme(
  config: unknown,
): Promise<import("@/backgrounds/store/backgroundStore").BackgroundStateSnapshot | null> {
  try {
    const { themeConfigToAppearance, appearanceHasBackground } = await import("@/lib/theme-appearance");
    if (!appearanceHasBackground(themeConfigToAppearance(config as never))) return null;
    const { snapshotBackgroundState, markThemeBackgroundPicked, setActiveBackgroundId } =
      await import("@/backgrounds/store/backgroundStore");
    const snapshot = snapshotBackgroundState();
    markThemeBackgroundPicked();   // this apply IS the newest explicit pick
    setActiveBackgroundId("none"); // ...so the template stops out-ranking it
    return snapshot;
  } catch {
    return null;
  }
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
