"use client";
/**
 * Escape hatch for the RETIRED legacy Themes screen (`ThemesManager` hosted in
 * `ThemesModal`). OFF by default: the operator's Themes button, the
 * `presentflow:open-themes-settings` event and Settings → "Open themes" all
 * land on the PP7 `ThemePopover` instead.
 *
 * Turn it back on with NEXT_PUBLIC_LEGACY_THEMES=1 (everyone) or localStorage
 * `presentflow.legacyThemes.v1` = "1" (this machine). With it on, every old
 * entry point reaches the full legacy modal exactly as before — the component
 * is retired, never deleted (rule 0).
 *
 * The web page /library/themes is NOT affected by this flag; it still renders
 * ThemesManager. See docs/THEMES_MANAGER_RETIREMENT.md §4.
 */
import { useEffect, useState } from "react";

export const LEGACY_THEMES_STORAGE_KEY = "presentflow.legacyThemes.v1";

export function readLegacyThemesFlag(): boolean {
  try {
    const local = window.localStorage.getItem(LEGACY_THEMES_STORAGE_KEY);
    if (local === "1") return true;
    if (local === "0") return false;
  } catch { /* storage unavailable */ }
  return process.env.NEXT_PUBLIC_LEGACY_THEMES === "1";
}

export function useLegacyThemes(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(readLegacyThemesFlag());
    const onStorage = (e: StorageEvent) => { if (e.key === LEGACY_THEMES_STORAGE_KEY) setOn(readLegacyThemesFlag()); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return on;
}

/** Fired when the Themes button / a legacy deep-link should open the popover. */
export const OPEN_THEME_POPOVER_EVENT = "presentflow:open-theme-popover";
