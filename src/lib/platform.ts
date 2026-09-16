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
