"use client";
/**
 * Apply a church theme from the operator (Themes tab + ProPresenter-style Theme
 * popover share this one path). Pushes the look (LIVE-ONLY — never the DB default)
 * to the live outputs (visual only — no DB write, no song restyle/lock) and
 * records it in Recents.
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
    // Church defaults (2026-09-23): applying mid-service is LIVE-ONLY. It no
    // longer POSTs /api/themes/[id]/apply (which rewrote the church's main
    // theme on every click). Only "Set as main theme" writes is_default.
    const { setLiveThemeId } = await import("@/lib/live-theme");
    setLiveThemeId(t.id);
    // Drive the live output immediately (same-machine, like font-scale) so the
    // projector/stage/livestream reflect the applied theme without a refetch.
    // OperatorConsole listens for this and emits it on OutputState.
    const { themeConfigToAppearance } = await import("@/lib/theme-appearance");
    window.dispatchEvent(new CustomEvent("presentflow:theme-changed", {
      detail: { appearance: themeConfigToAppearance(t.config), themeId: t.id },
    }));
    // 2026-09-23 review decision: a mid-service apply is VISUAL ONLY. It no
    // longer fires `presentflow:apply-theme-to-song` (which baked the theme
    // into the current song + set the plan item's theme in the DB and marked
    // the song styleLocked — so it stopped following later main-theme
    // changes). Plain lyric slides follow the live theme on their own now;
    // the explicit per-song "Apply theme to song" menu actions still bake+lock.
    pushThemeRecent(t.id);
    toast.success(`Theme "${t.name}" applied`);
    return true;
  } catch {
    toast.error("Could not apply theme");
    return false;
  }
}
