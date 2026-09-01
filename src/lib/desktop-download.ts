// Single source of truth for the hosted desktop download URLs — update the
// version when cutting a new release so onboarding + settings stay in sync.
// All three artifacts live on the SAME GitHub release tag (v<version>).
export const DESKTOP_DOWNLOAD_VERSION = "0.1.230";
const BASE = `https://github.com/benji-ss1/faithflow-ai/releases/download/v${DESKTOP_DOWNLOAD_VERSION}`;
// macOS (.dmg, unsigned)
export const DESKTOP_DOWNLOAD_ARM64_URL = `${BASE}/Present-Flow-${DESKTOP_DOWNLOAD_VERSION}-arm64-mac.dmg`;
export const DESKTOP_DOWNLOAD_X64_URL = `${BASE}/Present-Flow-${DESKTOP_DOWNLOAD_VERSION}-x64-mac.dmg`;
// Windows (NSIS .exe installer, unsigned)
export const DESKTOP_DOWNLOAD_WIN_URL = `${BASE}/PresentFlow-Setup-${DESKTOP_DOWNLOAD_VERSION}.exe`;
