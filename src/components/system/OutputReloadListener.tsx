"use client";
import { useEffect } from "react";

/**
 * Mounted on the output windows (projector /live, /stage, /livestream). When the
 * operator taps "clear cache & reload", it broadcasts on the "presentflow-reload"
 * channel; these windows are separate browser windows, so they must reload
 * themselves to pick up a fresh build. One-shot per signal → no reload loop.
 */
export function OutputReloadListener() {
  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel("presentflow-reload");
      bc.onmessage = (e) => {
        if (!e?.data || (e.data as { type?: string }).type !== "reload") return;
        void (async () => {
          try {
            if (typeof caches !== "undefined") {
              const keys = await caches.keys();
              await Promise.all(keys.map((k) => caches.delete(k)));
            }
            if ("serviceWorker" in navigator) {
              const regs = await navigator.serviceWorker.getRegistrations();
              await Promise.all(regs.map((r) => r.unregister()));
            }
          } catch { /* fall through to reload */ }
          try {
            const u = new URL(window.location.href);
            u.searchParams.set("_r", String(Date.now()));
            window.location.replace(u.toString());
          } catch {
            window.location.reload();
          }
        })();
      };
    } catch { /* BroadcastChannel unavailable — no-op */ }
    return () => { try { bc?.close(); } catch { /* noop */ } };
  }, []);
  return null;
}
