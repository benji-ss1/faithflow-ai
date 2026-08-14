"use client";
import { updateTheme, setDefaultTheme } from "@/lib/actions";
import { themeConfigToAppearance } from "@/lib/theme-appearance";

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
export function pushThemeLive(config: Record<string, unknown>): void {
  try {
    window.dispatchEvent(new CustomEvent("presentflow:theme-changed", {
      detail: { appearance: themeConfigToAppearance(config) },
    }));
  } catch { /* mapping unavailable — DB default still applies on next load */ }
}

// Notify other operator surfaces (the quick switcher, the modal) that the theme
// set changed so they can refresh their list/selection without a reload.
export function announceThemesChanged(): void {
  try { window.dispatchEvent(new CustomEvent("presentflow:themes-changed")); } catch { /* noop */ }
}

// Make `id` the default/active theme and push it live.
export async function switchToTheme(t: QuickTheme): Promise<boolean> {
  const res = await setDefaultTheme(t.id);
  if (!res.ok) return false;
  pushThemeLive(t.config);
  announceThemesChanged();
  return true;
}

// Set a media URL as the active theme's logo or background, persist it, and push
// live. Returns the theme name on success (for a toast), or null.
export async function setMediaOnActiveTheme(kind: "logo" | "background", url: string): Promise<string | null> {
  const themes = await fetchThemes();
  if (themes.length === 0) return null;
  const target = themes.find((t) => t.isDefault) ?? themes[0];
  const prev = target.config;
  const patch: Record<string, unknown> = kind === "logo"
    ? { logoUrl: url, logoPosition: (prev.logoPosition as string) && prev.logoPosition !== "none" ? prev.logoPosition : "bottom-right" }
    : { bgType: "image", bgImageUrl: url };
  const nextConfig = { ...prev, ...patch };
  const res = await updateTheme(target.id, { config: nextConfig });
  if (!res.ok) return null;
  if (target.isDefault) { pushThemeLive(nextConfig); }
  announceThemesChanged();
  return target.name;
}
