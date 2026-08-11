/* PresentFlow service worker — Hybrid Phase 0 (offline app shell).
 *
 * DELIBERATELY CONSERVATIVE. A buggy SW can brick a site, so this one:
 *  - is registered ONLY inside the Electron desktop shell (see
 *    ServiceWorkerRegister.tsx) — never on the multi-user web app;
 *  - cache-FIRST only for immutable, hashed, non-sensitive static assets
 *    (/_next/static, /brand, fonts) — these can never go stale;
 *  - network-FIRST for page navigations, falling back to a cached copy only
 *    when the network fails, so the app can OPEN offline;
 *  - NEVER caches API/data, auth, POST/mutations, or cross-origin requests —
 *    church-scoped data offline is Hybrid Phase 1's job (explicit IndexedDB);
 *  - self-heals: skipWaiting + clients.claim + versioned caches with cleanup,
 *    so a new deploy always takes over and old caches are purged.
 *
 * Recovery if this ever misbehaves: replace this file's body with just
 *   self.addEventListener('install',()=>self.skipWaiting());
 *   self.addEventListener('activate',(e)=>e.waitUntil(caches.keys().then(k=>Promise.all(k.map(c=>caches.delete(c)))).then(()=>self.registration.unregister()).then(()=>self.clients.matchAll()).then(cs=>cs.forEach(c=>c.navigate(c.url)))));
 * and deploy — every client will unregister on next load.
 */
const VERSION = "pf-sw-v1";
const STATIC_CACHE = `pf-static-${VERSION}`;
const RUNTIME_CACHE = `pf-runtime-${VERSION}`;
const MEDIA_CACHE = `pf-media-${VERSION}`; // cross-origin theme/media assets

const STATIC_PREFIXES = ["/_next/static/", "/brand/", "/fonts/"];
const STATIC_EXACT = new Set(["/favicon.ico"]);

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith("pf-") && !k.endsWith(VERSION)).map((k) => caches.delete(k)),
    );
    await self.clients.claim();
  })());
});

function isStatic(url) {
  return STATIC_PREFIXES.some((p) => url.pathname.startsWith(p)) || STATIC_EXACT.has(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;               // never touch mutations
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) {
    // Cross-origin MEDIA ONLY (theme backgrounds, logo, media slides) → cache so
    // it renders offline. Media bytes are not sensitive page/data (unlike the
    // same-origin authed HTML), and they're isolated in their own capped cache.
    // Everything else cross-origin (Stripe, APIs, etc.) is left untouched.
    if (req.destination === "image" || req.destination === "video") {
      event.respondWith(mediaCacheFirst(req));
    }
    return;
  }
  if (url.pathname.startsWith("/api/")) return;      // never cache data/auth

  if (isStatic(url)) {
    event.respondWith(cacheFirst(req));
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith(navHandler(req));
    return;
  }
  // Everything else (RSC payloads, etc.): network-only. Not cached — avoids
  // query-string cache bloat AND keeps church-scoped data off the SW entirely.
});

async function cacheFirst(req) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok && res.type === "basic") { try { await cache.put(req, res.clone()); } catch { /* quota */ } }
  return res;
}

// Navigations: network-first; on failure serve ONLY the exact cached URL (never
// an arbitrary page — that could show the wrong page, or another account's
// cached page offline on a shared machine). Note: these pages are cookie-authed
// (not Authorization-header), so they DO get cached — that's why the cache is
// purged on logout (see clearOfflineCaches) and capped here.
async function navHandler(req) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const res = await fetch(req);
    const ct = res && res.headers.get("content-type");
    // Skip REDIRECTED responses: caching a login/landing redirect under the
    // original URL would serve the wrong shell offline, and a redirected
    // response can't satisfy a navigation (respondWith would throw).
    if (res && res.ok && !res.redirected && res.type === "basic" && ct && ct.includes("text/html")) {
      try { await cache.put(req, res.clone()); await trimCache(RUNTIME_CACHE, 40); } catch { /* quota */ }
    }
    return res;
  } catch (err) {
    const hit = await cache.match(req); // exact URL only
    if (hit) return hit;
    throw err;
  }
}

// Cross-origin media: cache-first so it renders offline. Caches opaque (no-cors)
// responses too, since media elements request cross-origin assets no-cors.
async function mediaCacheFirst(req) {
  const cache = await caches.open(MEDIA_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === "opaque")) {
      try { await cache.put(req, res.clone()); await trimCache(MEDIA_CACHE, 60); } catch { /* quota */ }
    }
    return res;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    throw err;
  }
}

async function trimCache(name, max) {
  try {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
  } catch { /* ignore */ }
}

// Purge caches on demand (called from the client on logout / account switch).
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "PF_CLEAR_CACHES") {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("pf-")).map((k) => caches.delete(k)))));
  }
});
