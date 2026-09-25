"use client";
import { updateTheme, patchThemeConfig, setDefaultTheme } from "@/lib/actions";
import { themeConfigToAppearance } from "@/lib/theme-appearance";
import { snapshotBackgroundState, restoreBackgroundState } from "@/backgrounds/store/backgroundStore";
import { getLiveThemeId, setLiveThemeId, resolveActiveTheme } from "@/lib/live-theme";

export type QuickTheme = { id: string; name: string; config: Record<string, unknown>; isDefault?: boolean };

/**
 * Client-side helpers for changing the ACTIVE (default) theme from operator
 * surfaces outside the Themes modal — the top-bar quick switcher and the media
 * right-click "set as theme logo/background". Each pushes the change to the live
 * projector/stage/livestream via the same `presentflow:theme-changed` event the
 * Themes modal uses, so the output updates instantly.
 */

// Fetch the church's themes (id/name/config/isDefault) from the operator client.
export async function fetchThemes(): Promise<QuickTheme[]> {
  try {
    const res = await fetch("/api/themes").then((r) => r.json()) as { themes?: QuickTheme[] };
    return (res.themes ?? []).map((t) => ({
      id: t.id, name: t.name, config: (t.config as Record<string, unknown>) ?? {}, isDefault: t.isDefault ?? false,
    }));
  } catch {
    return [];
  }
}

// Drive the live output with a theme config (mirrors ThemesTab/ThemesModal).
export function pushThemeLive(config: Record<string, unknown>, themeId?: string): void {
  try {
    window.dispatchEvent(new CustomEvent("presentflow:theme-changed", {
      detail: { appearance: themeConfigToAppearance(config), ...(themeId ? { themeId } : {}) },
    }));
  } catch { /* mapping unavailable — DB default still applies on next load */ }
}

// Notify other operator surfaces (the quick switcher, the modal) that the theme
// set changed so they can refresh their list/selection without a reload.
export function announceThemesChanged(): void {
  try { window.dispatchEvent(new CustomEvent("presentflow:themes-changed")); } catch { /* noop */ }
}

// Push `t` LIVE (session-only). Church defaults 2026-09-23: this no longer
// writes the church's main theme — use setMainTheme for that.
export async function switchToTheme(t: QuickTheme): Promise<boolean> {
  setLiveThemeId(t.id);
  pushThemeLive(t.config, t.id);
  return true;
}

// Explicit "Set as main theme" (star): writes themes.is_default only. Does NOT
// change what is on the outputs right now.
export async function setMainTheme(id: string): Promise<boolean> {
  const res = await setDefaultTheme(id);
  if (!res.ok) return false;
  announceThemesChanged();
  return true;
}

// The theme a quick tweak edits = the theme LIVE right now (main theme before
// any in-session apply). Its edits are pushed live because it IS the live one.
function activeTarget(themes: QuickTheme[]): QuickTheme | null {
  return resolveActiveTheme(themes, getLiveThemeId());
}

// Result of a quick theme mutation: the theme name (for a toast) plus a
// `revert()` that restores the exact previous config and re-pushes it live —
// so the caller can offer a one-tap Undo. Null when there's no theme to change.
// revert() resolves true when the previous config was actually restored (and
// re-pushed live), false when the write failed or the theme no longer exists —
// so the caller can toast honestly instead of a false "Reverted".
export type QuickThemeChange = { name: string; revert: () => Promise<boolean> };

// Restore a theme's config to a prior snapshot and re-push it live if it's the
// active theme. Used to power Undo on quick background/logo changes.
async function applyConfig(target: QuickTheme, config: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await updateTheme(target.id, { config });
    if (!res.ok) return false;
    // Undo may land after the operator switched to another theme — only
    // re-push when this theme is still the one on the outputs.
    const liveId = getLiveThemeId();
    if (liveId ? liveId === target.id : target.isDefault) pushThemeLive(config, target.id);
    announceThemesChanged();
    return true;
  } catch {
    return false;
  }
}

// Build a revert() that restores BOTH the theme config AND the background
// template state that was active before the change. Applying a theme background
// clears any active template (mutual exclusivity), so a faithful Undo must put
// that template back too — restored AFTER the config so it wins the ordering.
function makeRevert(
  target: QuickTheme,
  prevConfig: Record<string, unknown>,
  bgSnapshot: ReturnType<typeof snapshotBackgroundState>,
): () => Promise<boolean> {
  return async () => {
    const ok = await applyConfig(target, prevConfig);
    restoreBackgroundState(bgSnapshot);
    return ok;
  };
}

// Set a media URL as the active theme's logo or background, persist it, and push
// live. Returns the theme name + an Undo `revert()` on success, or null.
export async function setMediaOnActiveTheme(kind: "logo" | "background", url: string): Promise<QuickThemeChange | null> {
  const themes = await fetchThemes();
  if (themes.length === 0) return null;
  const target = activeTarget(themes);
  if (!target) return null;
  const prev = target.config;
  const bgSnapshot = snapshotBackgroundState(); // capture BEFORE the change clears any template
  const patch: Record<string, unknown> = kind === "logo"
    ? { logoUrl: url, logoPosition: (prev.logoPosition as string) && prev.logoPosition !== "none" ? prev.logoPosition : "bottom-right" }
    : { bgType: "image", bgImageUrl: url };
  const nextConfig = { ...prev, ...patch };
  try {
    // Patch only these fields, merged server-side — a theme editor open at the
    // same time must not have its other edits erased by this one-tap action.
    const res = await patchThemeConfig(target.id, patch);
    if (!res.ok) return null;
  } catch {
    return null;
  }
  pushThemeLive(nextConfig, target.id);
  announceThemesChanged();
  return { name: target.name, revert: makeRevert(target, prev, bgSnapshot) };
}

// Clear the active theme's background (image or video) back to a plain solid
// colour and push live. Returns the theme name + Undo, or null when there's
// no theme / nothing to clear. This is the one-tap "undo my background" the
// operator reaches for when a media image was set as the theme background.
export async function clearActiveThemeBackground(): Promise<QuickThemeChange | null> {
  const themes = await fetchThemes();
  if (themes.length === 0) return null;
  const target = activeTarget(themes);
  if (!target) return null;
  const prev = target.config;
  const bgType = (prev.bgType as string) ?? "solid";
  const hasImageOrVideoBg = (bgType === "image" || bgType === "video")
    || !!prev.bgImageUrl || !!prev.bgVideoUrl;
  if (!hasImageOrVideoBg) return null; // nothing to clear
  const bgSnapshot = snapshotBackgroundState();
  const nextConfig = { ...prev, bgType: "solid" as const, bgImageUrl: "", bgVideoUrl: "" };
  try {
    const res = await patchThemeConfig(target.id, { bgType: "solid", bgImageUrl: "", bgVideoUrl: "" });
    if (!res.ok) return null;
  } catch {
    return null;
  }
  pushThemeLive(nextConfig, target.id);
  announceThemesChanged();
  return { name: target.name, revert: makeRevert(target, prev, bgSnapshot) };
}
