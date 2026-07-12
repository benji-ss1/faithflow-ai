"use client";

import { useEffect, useState } from "react";

export type Shell = "desktop" | "web";

// Client-side detection of the running shell. Truth on the server is the
// `x-pf-shell` header (set by Electron) + the `pf_shell` cookie (persisted
// by middleware). Client convenience: window.electronAPI is exposed by
// electron/preload.ts and is unforgeable from web.
// Y6: Optional initial value lets a Server Component pass the server-known
// shell (from `pf_shell` cookie / `x-pf-shell` header) so first paint is
// already correct — no flash of web chrome before the effect resolves.
export function useShell(initialShell?: Shell): Shell {
  const [shell, setShell] = useState<Shell>(initialShell ?? "web");
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.electronAPI) {
      setShell("desktop");
      return;
    }
    // Cookie fallback for renderer processes where the preload isn't ready
    // yet. Note pf_shell is httpOnly (Y2), so this only reads if a caller
    // sets a non-httpOnly duplicate; safe to keep as a no-op fallback.
    if (typeof document !== "undefined" && document.cookie.includes("pf_shell=desktop")) {
      setShell("desktop");
    }
  }, []);
  return shell;
}
