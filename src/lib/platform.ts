// Renderer platform detection (2026-09-16 Windows polish).
// Pure + SSR-safe. Used to scope Windows-only fixes so macOS behaviour stays
// byte-identical (CLAUDE.md rule 0 — never regress).

export function isWindowsUA(ua?: string): boolean {
  const s = ua ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  return /Windows/i.test(s);
}

/** Shortcut modifier label shown in UI: "⌘" on Mac, "Ctrl" on Windows/Linux. */
export function modKeyLabel(ua?: string): string {
  const s = ua ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  return /Mac|iPhone|iPad/i.test(s) ? "⌘" : "Ctrl ";
}

/**
 * Inline pre-hydration script: stamps <html data-platform="win"> on Windows so
 * globals.css can scope Windows-only overrides without touching macOS.
 */
export const PLATFORM_ATTR_SCRIPT =
  "try{if(/Windows/i.test(navigator.userAgent))document.documentElement.setAttribute('data-platform','win')}catch(e){}";

/**
 * Keyboard-shortcut label for the viewer's platform. On Mac the output is the
 * exact legacy glyph string (e.g. "⌘Z", "⌘⇧Z", "⌘↵") so existing Mac UI text is
 * unchanged; elsewhere it's "Ctrl+Shift+Z" / "Ctrl+Enter".
 */
export function shortcutLabel(
  keys: { mod?: boolean; shift?: boolean; alt?: boolean; key: string },
  ua?: string,
): string {
  const s = ua ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  if (/Mac|iPhone|iPad/i.test(s)) {
    return (keys.mod ? "⌘" : "") + (keys.shift ? "⇧" : "") + (keys.alt ? "⌥" : "") + keys.key;
  }
  const key = keys.key === "↵" ? "Enter" : keys.key;
  return [keys.mod && "Ctrl", keys.alt && "Alt", keys.shift && "Shift", key].filter(Boolean).join("+");
}

/** Operator right-panel width (px). Mac/other: always 360 (unchanged). Windows: compacts on small screens. */
export function rightPanelWidthFor(viewportW: number, win: boolean): number {
  if (!win) return 360;
  return viewportW < 960 ? 280 : viewportW < 1240 ? 300 : 360;
}
