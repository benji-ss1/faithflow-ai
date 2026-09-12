// Source of truth for the hosted desktop download URLs — used by onboarding +
// settings. Mac and Windows are SEPARATE apps with SEPARATE release cadences:
// a Windows-only build bumps the Windows version and leaves Mac untouched
// (and vice-versa). These constants are the FAIL-CLOSED FALLBACK — used the
// moment the client, offline, or GitHub is unreachable/rate-limited. They must
// always point at a real, already-published artifact. Bump them by hand
// whenever you cut+publish a new tagged DMG/exe release (see
// docs/DMG_RELEASE_SOP.md) — this is what keeps the fallback from silently
// going stale if the live GitHub lookup below ever fails.
export const DESKTOP_DOWNLOAD_MAC_VERSION = "0.1.322"; // last macOS DMG cut (NDI multi-channel isolation fix)
export const DESKTOP_DOWNLOAD_WIN_VERSION = "0.1.373"; // last Windows .exe cut

// Back-compat: some callers still import DESKTOP_DOWNLOAD_VERSION. Point it at
// the Mac version (its historical meaning) so nothing breaks, but prefer the
// per-OS constants above.
export const DESKTOP_DOWNLOAD_VERSION = DESKTOP_DOWNLOAD_MAC_VERSION;

const REL = "https://github.com/benji-ss1/faithflow-ai/releases/download";
const MAC_BASE = `${REL}/v${DESKTOP_DOWNLOAD_MAC_VERSION}`;
const WIN_BASE = `${REL}/v${DESKTOP_DOWNLOAD_WIN_VERSION}`;

// macOS (.dmg, unsigned) — static fallback, see note above.
export const DESKTOP_DOWNLOAD_ARM64_URL = `${MAC_BASE}/Present-Flow-${DESKTOP_DOWNLOAD_MAC_VERSION}-arm64-mac.dmg`;
export const DESKTOP_DOWNLOAD_X64_URL = `${MAC_BASE}/Present-Flow-${DESKTOP_DOWNLOAD_MAC_VERSION}-x64-mac.dmg`;
// Windows (NSIS .exe installer, unsigned) — static fallback, see note above.
export const DESKTOP_DOWNLOAD_WIN_URL = `${WIN_BASE}/PresentFlow-Setup-${DESKTOP_DOWNLOAD_WIN_VERSION}.exe`;

// ---------------------------------------------------------------------------
// Live lookup — so the dashboard auto-tracks whatever was most recently
// published to GitHub Releases, instead of requiring a code change + Vercel
// deploy every time a new DMG/exe is cut.
//
// GitHub's "latest" release endpoint only returns the single newest tag
// overall, which breaks here because Mac and Windows ship on independent
// cadences (e.g. a Windows-only v0.1.373 release has no .dmg at all — see
// git history 2026-09-12). So instead we scan the most recent releases and,
// per platform, take the newest one that actually carries a matching asset.
// ---------------------------------------------------------------------------

const GITHUB_RELEASES_URL = "https://api.github.com/repos/benji-ss1/faithflow-ai/releases?per_page=30";

export type DesktopDownloadUrls = {
  arm64Url: string;
  x64Url: string;
  winUrl: string;
  macVersion: string;
  winVersion: string;
  source: "live" | "fallback";
};

const FALLBACK_URLS: DesktopDownloadUrls = {
  arm64Url: DESKTOP_DOWNLOAD_ARM64_URL,
  x64Url: DESKTOP_DOWNLOAD_X64_URL,
  winUrl: DESKTOP_DOWNLOAD_WIN_URL,
  macVersion: DESKTOP_DOWNLOAD_MAC_VERSION,
  winVersion: DESKTOP_DOWNLOAD_WIN_VERSION,
  source: "fallback",
};

type GhAsset = { name?: string; browser_download_url?: string };
type GhRelease = { tag_name?: string; draft?: boolean; prerelease?: boolean; published_at?: string; assets?: GhAsset[] };

function findAsset(assets: GhAsset[], test: RegExp): GhAsset | undefined {
  return assets.find((a) => test.test(a.name || ""));
}

// Resolves the freshest published Mac (.dmg, both arches) and Windows (.exe)
// download URLs by scanning recent releases newest-first. Falls back to the
// hardcoded constants above on any network failure, rate-limit, or if no
// release in the scanned window carries the expected asset — this function
// must NEVER throw and must NEVER return a broken/partial URL set.
export async function resolveDesktopDownloadUrls(): Promise<DesktopDownloadUrls> {
  try {
    const res = await fetch(GITHUB_RELEASES_URL, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store",
    });
    if (!res.ok) return FALLBACK_URLS;
    const releases = (await res.json()) as GhRelease[];
    if (!Array.isArray(releases)) return FALLBACK_URLS;

    let arm64Url: string | null = null;
    let x64Url: string | null = null;
    let macVersion: string | null = null;
    let winUrl: string | null = null;
    let winVersion: string | null = null;

    for (const rel of releases) {
      if (rel.draft || rel.prerelease) continue;
      const assets = Array.isArray(rel.assets) ? rel.assets : [];
      const version = (rel.tag_name || "").replace(/^v/, "");
      if (!version) continue;

      if (!arm64Url || !x64Url) {
        const arm = findAsset(assets, /arm64-mac\.dmg$/i);
        const x64 = findAsset(assets, /(?<!arm64-)x64-mac\.dmg$/i);
        if (arm?.browser_download_url && x64?.browser_download_url) {
          arm64Url = arm.browser_download_url;
          x64Url = x64.browser_download_url;
          macVersion = version;
        }
      }
      if (!winUrl) {
        const win = findAsset(assets, /\.exe$/i);
        if (win?.browser_download_url) {
          winUrl = win.browser_download_url;
          winVersion = version;
        }
      }
      if (arm64Url && x64Url && winUrl) break;
    }

    if (!arm64Url || !x64Url || !winUrl || !macVersion || !winVersion) return FALLBACK_URLS;
    return { arm64Url, x64Url, winUrl, macVersion, winVersion, source: "live" };
  } catch {
    return FALLBACK_URLS; // offline / rate-limited / malformed response
  }
}
