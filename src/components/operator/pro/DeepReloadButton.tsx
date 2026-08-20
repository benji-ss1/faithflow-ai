"use client";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

/**
 * Top-nav "deep reload" — clears the caches that pin a stale build (CacheStorage
 * + any service worker) and hard-reloads. Works on the desktop app without a new
 * DMG. If the Electron shell later exposes a main-process cache-clear (HTTP +
 * shader cache), we call it too. Guarded behind a confirm so it can't be hit
 * mid-service by accident.
 */
export function DeepReloadButton() {
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (busy) return;
    if (!window.confirm("Clear cache and reload?\n\nThis also reloads the projector / stage / livestream windows. Do it between slides — takes a couple of seconds and pulls the latest version.")) return;
    setBusy(true);
    toast.info("Clearing cache & reloading all windows…");
    // Tell the separate output windows (projector /live, /stage, /livestream) to
    // reload too — they're their own windows, so the operator reloading alone
    // leaves them on a stale bundle. One-shot, user-triggered → no reload loop.
    try {
      const bc = new BroadcastChannel("presentflow-reload");
      bc.postMessage({ type: "reload", at: Date.now() });
      setTimeout(() => { try { bc.close(); } catch { /* noop */ } }, 500);
    } catch { /* BroadcastChannel unavailable — operator still reloads below */ }
    try {
      // Renderer-clearable caches (the offline-cache that pins stale builds).
      if (typeof caches !== "undefined") {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      // Optional deeper clear if the Electron shell exposes it (future DMG).
      const api = (window as unknown as { electronAPI?: { app?: { clearCacheAndReload?: () => Promise<void> } } }).electronAPI;
      if (api?.app?.clearCacheAndReload) {
        await api.app.clearCacheAndReload();
        return; // main process reloads
      }
    } catch {
      /* fall through to a plain reload */
    }
    // Cache-busting param forces the document + entry to be re-fetched fresh.
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("_r", String(Date.now()));
      window.location.replace(u.toString());
    } catch {
      window.location.reload();
    }
  };

  return (
    <button
      onClick={run}
      disabled={busy}
      title="Clear cache & reload — pull the latest version"
      aria-label="Clear cache and reload"
      className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:border-[var(--color-muted-foreground)] transition-colors disabled:opacity-50"
    >
      <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} />
    </button>
  );
}
