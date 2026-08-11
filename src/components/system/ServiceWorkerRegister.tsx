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
    // DISABLED 2026-08-11: the Phase-0 offline SW pinned the desktop to a stale
    // build and (via the kill-switch's forced navigate) caused an audio-killing
    // reload loop. We no longer register a service worker. Instead, actively
    // unregister any worker still installed on this client so it can never
    // control the page again. The app runs online-only (its pre-Phase-0
    // behavior). A corrected offline SW can be reintroduced later behind tests.
    navigator.serviceWorker.getRegistrations()
      .then((regs) => regs.forEach((r) => { void r.unregister(); }))
      .catch(() => { /* nothing to clean up */ });
  }, []);
  return null;
}
