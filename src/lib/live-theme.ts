"use client";
/**
 * Church defaults (2026-09-23, user-approved): the MAIN theme vs the LIVE theme.
 *
 *  - MAIN theme  = `themes.is_default` in the DB. Only an explicit "Set as main
 *    theme" (star) writes it. It is what loads on every app start.
 *  - LIVE theme  = whatever the operator applied mid-service. Session-only: it
 *    drives the outputs via `presentflow:theme-changed` and NEVER writes the DB.
 *
 * The live id is mirrored into per-window sessionStorage (2026-09-23 review
 * decision): a console reload (⌘R / crash recovery) or a plan navigation in
 * the SAME app session keeps what is on the outputs; a fresh app launch (new
 * window → empty sessionStorage) starts on the main theme. OperatorConsole's
 * mount load reads it back and pins the live id (to the main theme when none
 * is stored) so starring another theme never moves "Live now".
 * Client-only UI state inside one renderer window — not server session state.
 */
import { useEffect, useState } from "react";

export const LIVE_THEME_EVENT = "presentflow:live-theme-id-changed";
export const LIVE_THEME_SESSION_KEY = "presentflow.liveThemeId.v1";

let liveThemeId: string | null = null;
let hydrated = false;

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  try {
    const v = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(LIVE_THEME_SESSION_KEY) : null;
    if (v && liveThemeId == null) liveThemeId = v;
  } catch { /* storage blocked */ }
}

export function getLiveThemeId(): string | null {
  hydrate();
  return liveThemeId;
}

export function setLiveThemeId(id: string | null): void {
  hydrated = true;
  liveThemeId = id;
  try {
    if (typeof sessionStorage !== "undefined") {
      if (id) sessionStorage.setItem(LIVE_THEME_SESSION_KEY, id);
      else sessionStorage.removeItem(LIVE_THEME_SESSION_KEY);
    }
  } catch { /* storage blocked */ }
  try { window.dispatchEvent(new CustomEvent(LIVE_THEME_EVENT, { detail: { id } })); } catch { /* SSR / no window */ }
}

/**
 * Which theme the console mount should put on the outputs: the persisted live
 * theme when it still exists, else the main theme. Pure — unit-tested.
 */
export function resolveMountTheme<T extends ThemeLike>(themes: T[], persistedLiveId: string | null): T | null {
  if (persistedLiveId) {
    const hit = themes.find((t) => t.id === persistedLiveId);
    if (hit) return hit;
  }
  return themes.find((t) => t.isDefault) ?? null;
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

/** Admin-only gate for "Set as main theme" (cached per window). */
let canManagePromise: Promise<boolean> | null = null;
export function useCanManageChurch(): boolean {
  const [can, setCan] = useState(false);
  useEffect(() => {
    let alive = true;
    canManagePromise ??= import("@/lib/actions").then((m) => m.canManageChurchDefaults()).catch(() => { canManagePromise = null; return false; });
    void canManagePromise.then((v) => { if (alive) setCan(v); });
    return () => { alive = false; };
  }, []);
  return can;
}

/** React hook — re-renders when the live theme changes. */
export function useLiveThemeId(): string | null {
  const [id, setId] = useState<string | null>(liveThemeId);
  useEffect(() => {
    const on = () => setId(getLiveThemeId());
    on();
    window.addEventListener(LIVE_THEME_EVENT, on);
    return () => window.removeEventListener(LIVE_THEME_EVENT, on);
  }, []);
  return id;
}
