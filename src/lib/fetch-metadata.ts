// Fetch Metadata guard for GET routes that change auth state (device-exchange,
// dev-login). When the browser sends Sec-Fetch-* headers the request must be a
// top-level document navigation. Absent headers (very old clients / embedders
// that omit them) are allowed: every modern Chromium — including Electron's
// BrowserWindow.loadURL, the legitimate caller — sends them on navigations, so
// the attack vector (a same-origin <img>/CSS/fetch subresource) is always
// labelled and always refused.
export function isTopLevelNavigation(headers: { get(name: string): string | null }): boolean {
  const dest = headers.get("sec-fetch-dest");
  const mode = headers.get("sec-fetch-mode");
  if (dest !== null && dest !== "document") return false;
  if (mode !== null && mode !== "navigate") return false;
  // Cross-site / same-site navigations (a link or form on another origin) are
  // refused; Electron's loadURL and typed/bookmarked URLs send "none", in-app
  // links send "same-origin". Speculative loads (prefetch / prerender) carry
  // Sec-Purpose and must never swap a session.
  const site = headers.get("sec-fetch-site");
  if (site !== null && site !== "none" && site !== "same-origin") return false;
  if (headers.get("sec-purpose") !== null) return false;
  return true;
}
