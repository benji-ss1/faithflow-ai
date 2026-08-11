"use client";
import { useEffect } from "react";

/**
 * Registers the offline-shell service worker (public/sw.js) — Hybrid Phase 0.
 *
 * DESKTOP-ONLY BY DESIGN: only registers inside the Electron shell, never on the
 * multi-user web app, so a service-worker bug can only ever affect the
 * auto-updating desktop client (the offline target) — not every web user.
 * Production only, and fully fail-safe: if registration throws, the app just
 * runs online as before.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    const isElectron =
      !!(window as { electronAPI?: unknown }).electronAPI ||
      (typeof navigator !== "undefined" && navigator.userAgent.includes("Electron"));
    if (!isElectron) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch(() => { /* offline shell unavailable — app works normally online */ });
  }, []);
  return null;
}
