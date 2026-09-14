// Pure desktop-OS detection for the download page — ORDERING ONLY.
//
// Used only to decide which download card leads. We never label a card as
// "this computer": UA sniffing is unreliable (Windows users were seeing the
// Mac card flagged), and every macOS browser reports "Intel Mac OS X" even on
// Apple Silicon, so we never claim which Mac architecture the user has.

export type DesktopOs = "windows" | "mac" | "other";

type NavLike = {
  userAgent?: string;
  platform?: string;
  userAgentData?: { platform?: string } | null;
};

export function detectDesktopOs(nav: NavLike | null | undefined): DesktopOs {
  if (!nav) return "other";
  // Client Hints (Chromium) are authoritative when present.
  const hint = (nav.userAgentData?.platform || "").toLowerCase();
  if (hint) {
    if (hint.includes("windows")) return "windows";
    if (hint.includes("mac")) return "mac";
    return "other";
  }
  const ua = (nav.userAgent || "").toLowerCase();
  const plat = (nav.platform || "").toLowerCase();
  // iOS/iPadOS UAs contain "like Mac OS X" — not a desktop Mac.
  if (/iphone|ipad|ipod|android/.test(ua)) return "other";
  // Match "windows nt" / "win32|win64" — NOT a bare "win" (which "darwin" contains).
  if (/windows nt|win32|win64/.test(ua) || plat.startsWith("win")) return "windows";
  if (ua.includes("macintosh") || ua.includes("mac os x") || plat.startsWith("mac")) return "mac";
  return "other";
}
