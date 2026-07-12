"use client";

import { useEffect, useState } from "react";

export type Shell = "desktop" | "web";

// Client-side detection of the running shell. Truth on the server is the
// `x-pf-shell` header (set by Electron) + the `pf_shell` cookie (persisted
// by middleware). Client convenience: window.electronAPI is exposed by
// electron/preload.ts and is unforgeable from web.
export function useShell(): Shell {
  const [shell, setShell] = useState<Shell>("web");
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.electronAPI) {
      setShell("desktop");
      return;
    }
    // Cookie fallback for renderer processes where the preload isn't ready yet.
    if (typeof document !== "undefined" && document.cookie.includes("pf_shell=desktop")) {
      setShell("desktop");
    }
  }, []);
  return shell;
}
