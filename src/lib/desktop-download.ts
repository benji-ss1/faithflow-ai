// Single source of truth for the hosted dmg URLs — update this when cutting
// a new release so both the onboarding and settings download pages stay in
// sync automatically instead of drifting.
export const DESKTOP_DOWNLOAD_VERSION = "0.1.9";
export const DESKTOP_DOWNLOAD_ARM64_URL = `https://github.com/benji-ss1/faithflow-ai/releases/download/v${DESKTOP_DOWNLOAD_VERSION}/Present-Flow-${DESKTOP_DOWNLOAD_VERSION}-arm64-mac.dmg`;
export const DESKTOP_DOWNLOAD_X64_URL = `https://github.com/benji-ss1/faithflow-ai/releases/download/v${DESKTOP_DOWNLOAD_VERSION}/Present-Flow-${DESKTOP_DOWNLOAD_VERSION}-x64-mac.dmg`;
