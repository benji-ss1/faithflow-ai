# Increment 4 — Offline Launch via Electron-Level Cache (build plan)

_Status: NOT built. **The Apple-signing gate recorded here was wrong** (corrected 2026-09-22): `package.json` sets `mac.identity: null`, so PresentFlow already ships **unsigned** DMGs today. An Electron change ships in exactly the same unsigned DMG. Signing is worth doing on its own merits; it does not block this._

_Prerequisite SHIPPED 2026-09-22: `/api/health` now returns `buildId` (the deploy commit SHA) and `offlineCache` (a remote kill-switch). See §7._

_Decision record: the user chose Electron-level caching over a service worker. **Why not a service worker:** the previous offline SW pinned the desktop to a stale build AND its forced-navigate caused a reload loop that reconnected the audio WebSocket every 1–2s — it bricked live audio. `public/sw.js` is now a deliberate kill-switch. See `docs/AI_HANDOFF.md` §5 and the memory `reminder_presentflow_local_first`._

---

## 1. Goal

When the venue's internet is down **at app launch** (or drops and the renderer reloads), the operator screen + output windows must load from a **local Electron cache** instead of the current "reconnecting…" splash. Combined with the already-shipped renderer pieces, this lets an operator **run a fully-prepared service with zero internet**.

**In scope:** the critical routes only — operator console (`/services/[id]/operate`), `/live`, `/stage`, `/livestream`, and their `/_next/*` JS/CSS assets. **Out of scope:** admin/billing/library/analytics (stay remote thin-client; they're not needed during a live service).

## 2. What already exists to build on (do NOT rebuild)

- **Renderer hydration is ready.** Increment 3 already makes `OperatorConsole` restore the current service from IndexedDB (`presentflow-offline`) when offline at mount, and increments 2a/2b put the whole Bible in IndexedDB (`presentflow-bible`). So once the cached *page* loads offline, it has its *data*. Increment 4 only needs to serve the page shell + assets.
- **The output windows are trivially offline-safe** — `/live` `/stage` `/livestream` are pure client components with **zero** API calls; they render from BroadcastChannel/`pf:live`. They just need their HTML + JS served offline.
- **`electron/main.ts` already has `loadWithRecovery()`** (splash + infinite-backoff reconnect) and `did-fail-load`/`render-process-gone` handlers. Increment 4 hooks INTO this — on offline nav failure, serve cache instead of (or before) the splash, and keep the splash as the ultimate fallback.

## 3. Recommended mechanism — persist-and-serve (network-first), fail-safe

Chromium won't disk-cache the Next.js document/RSC (Vercel sends `no-store`). So we do an **explicit main-process response cache**:

1. **Persist on success.** In the Electron **main process**, intercept responses for the app origin's critical routes + `/_next/*` assets and write `{body, headers, status}` to disk under `app.getPath('userData')/pfcache/`. Key by request URL (normalized). Use `session.defaultSession` + either:
   - a `protocol.handle`/`net`-based fetch proxy that fetches upstream, streams to the window, and tees to disk, **or**
   - `session.webRequest` for header capture + a companion `net.fetch` to persist bodies (webRequest can't read bodies).
   Prefer whichever is simplest to make robust; the proxy/`protocol.handle` route gives the most control.
2. **Network-FIRST always.** When online, always go to the network and refresh the cache. **Never serve cache while online** → this is what prevents the stale-build pinning that killed the SW. (Optionally revalidate `/_next/static/*` by content hash — those URLs are already immutable, so they're safe to serve from cache directly.)
3. **Serve on failure only.** On `did-fail-load` (or a fetch that fails offline), serve the persisted copy from disk for the requested URL. The renderer's cached JS boots and hydrates plan+Bible from IndexedDB.
4. **Fail-safe.** If there's no cached copy (never loaded online before) or it's corrupt → fall through to the **existing splash** (`loadWithRecovery`). Increment 4 must be **strictly never worse than today**: a bug in the cache path must degrade to the current behavior, not a white screen.

**Alternative (simpler, less control):** rewrite critical-route response `Cache-Control` via `onHeadersReceived` so Chromium's own persistent disk cache stores them, then on offline nav retry `loadURL` (Chromium serves cached). Less code but relies on Chromium cache semantics being exactly right across versions — riskier to guarantee. Recommend the explicit persist-and-serve above; keep this as a fallback idea.

## 4. Files

- `electron/main.ts` — hook the cache into `loadWithRecovery`/`did-fail-load` (the critical load path — touch surgically, keep the splash fallback).
- `electron/cache/offlineCache.ts` (NEW) — the persist-and-serve module: `primeOnResponse()`, `serveFromCache(url)`, disk store under `userData/pfcache/`, an allowlist of cacheable URL patterns (the 4 critical routes + `/_next/*`), and a size cap + LRU eviction.
- `electron/preload.ts` — only if the renderer needs a signal (e.g. "loaded-from-cache" → show an offline chip). Optional.
- Possibly `electron/windows/OutputWindow.ts` — apply the same serve-from-cache to the projector/stage/livestream windows (they already have `output-fallback.html` black-screen fallback).

## 5. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Stale build pinned** (the old SW's sin) | Network-FIRST; only serve cache on actual network failure. Never serve cache online. |
| **Bricking the load path** (highest blast radius) | Every cache branch falls through to the existing splash on any error. Feature-flag it (env/setting) so it can be disabled without a new build if it misbehaves. |
| **CSP / asset base-href breakage when serving cached HTML** | Serve under the SAME origin scheme the app expects (intercept the real origin, don't rewrite to `file://`), so relative asset URLs + CSP still resolve. |
| **Partial cache (some assets cached, some not)** | Only serve-from-cache when the document AND its referenced `/_next/*` chunks are all present; else splash. |
| **Can't be tested headlessly** | This MUST be tested on-device: load online once, quit, turn off wifi, relaunch → operator console + outputs must load and a prepared service must run. Document as untestable-by-agent; the user runs the offline acceptance test. |
| **Cache disk growth** | Size cap + LRU under `userData/pfcache/`; the critical routes + `_next` chunks are small (a few MB). |

## 6. Acceptance test (user runs on-device)

1. Launch online, open the operator console for today's service, let it fully load. Open `/live` on the projector.
2. Quit the app. **Disable wifi.** Relaunch.
3. ✅ Operator console loads (from cache) — not the splash.
4. ✅ The prepared service is present (plan restored from IndexedDB), scripture projects (Bible from IndexedDB), slides advance to `/live` (BroadcastChannel).
5. ✅ AI shows honest "offline / manual mode" (graceful degradation).
6. Re-enable wifi → app revalidates to the fresh build on next launch (no stale pin).
7. Regression: with wifi ON, everything behaves exactly as today (network-first).

## 7. Ship

- **Requires a signed + notarized DMG** (Electron-layer change). Do Apple enrollment first, then this ships in the same DMG.
- Follow `docs/DMG_RELEASE_SOP.md`. Version-align the shell to the renderer changelog head. Add a "What's New" entry (`src/lib/changelog.ts`) describing offline launch.
- 3-agent review before ship (touches the Electron load path + output windows). Extra scrutiny on the fail-safe fallback and the network-first guarantee.

## 8. Sequenced sub-steps

1. `offlineCache.ts` — disk store + allowlist + size cap (pure, unit-testable).
2. Wire `primeOnResponse` into the session so successful critical-route/asset loads persist. Verify online behavior unchanged (network-first).
3. Wire `serveFromCache` into `did-fail-load`/`loadWithRecovery`, behind a flag, with splash fallback.
4. Apply to output windows.
5. On-device offline acceptance test (user).
6. 3-agent review → signed DMG → changelog → ship.


---

## 7. Amendments (2026-09-22) — non-negotiable, after re-reading the 2026-08-11 incidents

The service worker shipped at 09:06 and was killed at 14:06 the same day, then its *fix* caused a second incident at 14:26. Both are quoted in `git log`. The three rules below are what those five hours actually taught, and §§1–6 above are under-specified on each.

### Amendment 1 — cache atomically, per build id

Key the store by **build generation**, not by URL alone.

- On each successful **online** load, read `buildId` from `/api/health`, and write that load's document **and every `/_next/*` chunk it referenced** into `pfcache/<buildId>/`.
- **Only serve a generation where the document AND every referenced chunk are present.** A half-captured generation is never served — it would produce a white screen, which is strictly worse than the honest splash it replaced.
- Promote a generation to "current" **only after a complete capture**, by an atomic rename. Never by writing into the live directory.
- Keep exactly **two** generations (current + previous). That bounds disk and buys one free rollback. Delete anything older.

Mixing a document from one build with chunks from another is the classic Next.js `ChunkLoadError` / hydration-mismatch white screen. Per-generation directories make it structurally impossible rather than merely unlikely.

### Amendment 2 — the escape hatch must not loop

The 14:26 incident was the **recovery mechanism** looping, not the cache. So:

- **The cache never triggers a navigation. Ever.** No `clients.navigate`, no auto-reload, no self-refresh. It only ever *answers* a load the app already asked for. This is the single most important constraint in this document.
- **Network-first always** — if the network answers, the network wins, every time. The cache is only reachable when the alternative is a splash screen. This is what structurally prevents the stale-build pinning; it is not a heuristic.
- Recovery without a support call, in three layers that already exist in the codebase:
  1. **Automatic:** next launch with working internet → network-first wins → fresh build, cache re-primed. Zero user action. This covers almost every case.
  2. **One keystroke:** Cmd+Shift+R is already wired to "Clear Cache and Reload" in `electron/main.ts`. Extend it to also wipe `userData/pfcache/`. Operators can be told that one key fixes anything.
  3. **In-app:** `src/components/operator/pro/DeepReloadButton.tsx` already probes for `electronAPI.app.clearCacheAndReload`. Implement that IPC and the button becomes the full recovery path for a non-technical operator.
- **Remote kill-switch.** The cache reads `offlineCache` from `/api/health` **and** an env var, and is OFF unless both allow it. If it misbehaves in the field it is turned off for every church **without shipping a DMG** — the property that made the `sw.js` kill-switch possible, which an Electron-side cache does not get for free.

### Amendment 3 — auth, and the poisoning case §§1–6 miss

`src/middleware.ts` redirects to `/login` when there is no token, and its matcher covers the console route. Two things must be verified **on-device** before this is trusted:

- **(a)** A cached document served offline still carries a valid session cookie from `session.defaultSession`. It should — cookies are persisted and the JWT is decoded per request — but this is assumed, not proven.
- **(b)** A **redirected** navigation is never persisted as the cached copy of `/operator`. The old service worker had exactly this guard ("redirected navs not cached — no auth-redirect poisoning", commit `2dd69cc`); it is not mentioned anywhere in §§1–6 and must be ported. Without it, one expired-session load poisons the cache with a login page, and the church boots to `/login` with no network and no way back.

Also verify that the cached copy **replays the global security headers** from `next.config.ts` — CSP behaving differently offline is a plausible and hard-to-diagnose failure.

### Scope guard

Exclude `/api/*` from interception entirely, and allowlist narrowly. `protocol.handle` on the default session can otherwise subtly break the NDI offscreen window, the LAN overlay server, and the device-exchange auth hop.

### Do not build a partial version

Half a persist-and-serve cache — one that serves an incomplete generation, or that ever wins while online — is **worse than today's splash screen**, because a splash is unambiguous and a white screen at 8:45am is not. If Amendments 1–3 cannot all ship, ship none of it.

### What cannot be verified by an agent

All of it. The acceptance test in §6 must be run **on-device by a human**: load online, quit, disable wifi, relaunch → console + `/live` load, the prepared service runs, scripture projects, slides advance, AI degrades honestly; then wifi on → the next launch is the fresh build.
