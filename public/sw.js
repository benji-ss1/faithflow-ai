/* PresentFlow service worker — DISABLED (kill-switch, non-looping).
 *
 * The Phase-0 offline SW could pin the desktop app to a stale cached build.
 * This replacement unregisters itself and purges every cache, then passes all
 * requests straight through. It does NOT force-navigate clients (an earlier
 * version did, which — combined with the client re-registering the worker on
 * every load — caused a reload loop that made the audio WebSocket reconnect
 * every 1-2s). Recovery is a single manual reload by the operator; no auto
 * navigation, so there is no loop.
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
    // Take control so this pass-through worker (not the old caching one) handles
    // the current page's requests, then unregister so future loads have no SW.
    try { await self.clients.claim(); } catch { /* ignore */ }
    try { await self.registration.unregister(); } catch { /* ignore */ }
    // Deliberately NO client.navigate() here — see header. The operator reloads
    // once, manually, to pick up the fresh build.
  })());
});

// Pass through every request untouched — no caching, no interception.
self.addEventListener("fetch", () => { /* no-op: let the network handle it */ });
