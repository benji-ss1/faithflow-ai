// Source of truth for the hosted desktop download URLs — used by onboarding +
// settings. Mac and Windows are SEPARATE apps with SEPARATE release cadences:
// a Windows-only build bumps WIN_VERSION and leaves Mac untouched (and vice-
// versa); a build cut for both bumps both. Each OS's URL always points at a
// real artifact on ITS release tag, so a user can only download the build for
// the OS they're on and never lands on a 404 for the other platform's version.
export const DESKTOP_DOWNLOAD_MAC_VERSION = "0.1.230"; // last macOS DMG cut
export const DESKTOP_DOWNLOAD_WIN_VERSION = "0.1.373"; // last Windows .exe cut

// Back-comat: some callers still import DESKTOP_DOWNLOAD_VERSION. Point it at
// the Mac version (its historical meaning) so nothing breaks, but prefer the
// per-OS constants above.
export const DESKTOP_DOWNLOAD_VERSION = DESKTOP_DOWNLOAD_MAC_VERSION;

const REL = "https://github.com/benji-ss1/faithflow-ai/releases/download";
const MAC_BASE = `${REL}/v${DESKTOP_DOWNLOAD_MAC_VERSION}`;
const WIN_BASE = `${REL}/v${DESKTOP_DOWNLOAD_WIN_VERSION}`;

// macOS (.dmg, unsigned)
export const DESKTOP_DOWNLOAD_ARM64_URL = `${MAC_BASE}/Present-Flow-${DESKTOP_DOWNLOAD_MAC_VERSION}-arm64-mac.dmg`;
export const DESKTOP_DOWNLOAD_X64_URL = `${MAC_BASE}/Present-Flow-${DESKTOP_DOWNLOAD_MAC_VERSION}-x64-mac.dmg`;
// Windows (NSIS .exe installer, unsigned)
export const DESKTOP_DOWNLOAD_WIN_URL = `${WIN_BASE}/PresentFlow-Setup-${DESKTOP_DOWNLOAD_WIN_VERSION}.exe`;
