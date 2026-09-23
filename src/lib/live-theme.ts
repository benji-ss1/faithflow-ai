"use client";
/**
 * Church defaults (2026-09-23, user-approved): the MAIN theme vs the LIVE theme.
 *
 *  - MAIN theme  = `themes.is_default` in the DB. Only an explicit "Set as main
 *    theme" (star) writes it. It is what loads on every app start.
 *  - LIVE theme  = whatever the operator applied mid-service. Session-only: it
 *    drives the outputs via `presentflow:theme-changed` and NEVER writes the DB.
 *
 * The live id lives in a per-window module variable on purpose (not
 * sessionStorage): an app reload (⌘⇧R) must come back on the main theme, which
 * is exactly what OperatorConsole's mount load does. This is client-only UI
 * state inside one renderer window — not server session state.
 */
import { useEffect, useState } from "react";

export const LIVE_THEME_EVENT = "presentflow:live-theme-id-changed";

let liveThemeId: string | null = null;

export function getLiveThemeId(): string | null {
  return liveThemeId;
}

export function setLiveThemeId(id: string | null): void {
  liveThemeId = id;
  try { window.dispatchEvent(new CustomEvent(LIVE_THEME_EVENT, { detail: { id } })); } catch { /* SSR / no window */ }
}

type ThemeLike = { id: string; isDefault?: boolean };

/**
 * The theme a one-tap tweak (A+/A−, "set as theme background/logo") edits: the
 * theme that is LIVE right now; before any in-session apply that is the main
 * theme; with no main theme, the first one. Pure — unit-tested.
 */
export function resolveActiveTheme<T extends ThemeLike>(themes: T[], liveId: string | null): T | null {
  if (themes.length === 0) return null;
  if (liveId) {
    const live = themes.find((t) => t.id === liveId);
    if (live) return live;
  }
  return themes.find((t) => t.isDefault) ?? themes[0];
}

/** True when `t` is the theme currently on the outputs. Pure — unit-tested. */
export function isThemeLiveNow(t: ThemeLike, themes: ThemeLike[], liveId: string | null): boolean {
  if (liveId && themes.some((x) => x.id === liveId)) return t.id === liveId;
  return t.isDefault === true;
}

/** React hook — re-renders when the live theme changes. */
export function useLiveThemeId(): string | null {
  const [id, setId] = useState<string | null>(liveThemeId);
  useEffect(() => {
    const on = () => setId(liveThemeId);
    on();
    window.addEventListener(LIVE_THEME_EVENT, on);
    return () => window.removeEventListener(LIVE_THEME_EVENT, on);
  }, []);
  return id;
}
