/* PresentFlow service worker — DISABLED (kill-switch).
 *
 * The previous offline-shell SW (Phase 0) could pin the desktop app to a
 * stale cached version, which hid renderer updates AND left the desktop on an
 * old audio client that no longer matched the updated audio bridge. This
 * replacement UNREGISTERS itself and purges every cache on the next load, then
 * force-reloads each client so the desktop returns to always-fresh, network-only
 * behavior (identical to pre-Phase-0). Deploy this and every desktop client
 * self-heals on its next navigation — no operator DevTools needed.
 *
 * A corrected offline SW can be re-introduced later behind proper testing.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch { /* ignore */ }
    try { await self.registration.unregister(); } catch { /* ignore */ }
    try {
      const clients = await self.clients.matchAll({ type: "window" });
      for (const c of clients) {
        // Force each open window to reload WITHOUT the SW controlling it, so it
        // fetches the current app straight from the network.
        try { c.navigate(c.url); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  })());
});

// Pass through every request untouched — no caching, no interception.
self.addEventListener("fetch", () => { /* no-op: let the network handle it */ });
