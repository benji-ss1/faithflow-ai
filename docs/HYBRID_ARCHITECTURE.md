# PresentFlow — Hybrid Architecture Plan

**Goal (user directive, 2026-08-11):** make PresentFlow **less dependent on the web app** and **strong enough to run a live service even when wifi is bad or Vercel is unreachable** — while keeping the good parts of the thin client (instant updates via Vercel, no per-machine build/deploy). It should **no longer be "a very thin client that relies on the web app."**

## Where we are today (the constraint)

- **Electron shell** (`electron/main.ts`) is a thin client: on launch it loads `https://faithflow-ai.vercel.app` (`PF_APP_URL`). No local Next server.
- If the internet or Vercel is down at launch, the shell shows a fallback and the UI never boots. Mid-service wifi drops break AI (Fly bridge + Groq) and can break navigation (fresh RSC fetches).
- Data (plan, songs, slides, Bible) lives in Supabase; every read is a network round-trip.
- Output windows (`/live`, `/stage`, `/livestream`) already have crash/fail-load recovery + a black fallback (0.1.124), and BroadcastChannel is the same-machine sync primitive (CLAUDE.md rule 8) — so **once loaded**, the operator→projector loop is already local and resilient.

The gap is **cold-start and data**: the *first load* needs Vercel, and *reads* need Supabase.

## The "best of both worlds" target

Keep the shell thin (loads the hosted app, auto-updates), but add three local layers so a service survives an outage:

1. **App-shell cache** — a service worker precaches the built app shell + static chunks. The UI boots from cache when offline; updates silently on reconnect. (This is the single biggest win: the app *opens* offline.)
2. **Today's-service cache** — the current service plan + its songs/slides + any pre-loaded Bible verses are cached locally (IndexedDB via the Cache API / a typed store). The operator can navigate + project the whole service with no network.
3. **Graceful degradation** — features that genuinely need the network (AI listening via Fly+Groq, semantic search, saving edits) degrade to manual/queued, with a clear "offline" indicator, instead of breaking the present loop.

Explicitly **NOT** doing (keeps it from becoming a heavy self-hosted app): no local Postgres, no bundled Next server, no local AI models beyond what already ships. The source of truth stays Supabase; local is a **read cache + resilience layer**.

---

## Phased plan

### Phase 0 — App-shell service worker (SAFEST, highest value, renderer-only)
Make the app **open and run offline** from a cached shell.
- Add a service worker (`public/sw.js` + registration in the root layout, Electron-only or all-clients) that precaches the app shell (HTML/JS/CSS chunks) with a **stale-while-revalidate** strategy for the app shell and **network-first** for API/data.
- Next.js App Router: use a `next-pwa`-style SW or a hand-rolled SW (prefer hand-rolled to avoid a heavy dep — the CSP/thin-client constraints are specific). Cache-bust on each deploy via the build id.
- **Safety:** SW only caches GET app-shell/static; never caches auth/mutations; versioned cache with cleanup; scoped so it can't serve a stale *data* response as fresh. Ships via Vercel; on the current Electron shell it "just works" (Electron renderer supports SWs). Inert if it fails to register.
- **Result:** if Vercel is down or wifi drops at launch, the operator still gets the full UI from cache.

### Phase 1 — Today's-service local cache
Cache the **current plan's data** so the service runs fully offline.
- On plan load, write the expanded plan (`getExpandedServicePlan` output: items + slides) + referenced song slides + church settings (blank bg, logo, default theme, themes) into an IndexedDB store (`presentflow.serviceCache.v1`).
- On read, prefer the network; on failure, fall back to the cached plan. A small `useServiceCache` hook wraps the existing plan fetch.
- Pre-warm on "start service": fetch + cache the whole plan + assets (theme bg images/videos, logo) via the Cache API so media renders offline too.
- **Bible:** the KJV/WEB local/public-domain verses are already DB-served; cache the verses referenced by the plan + a small hot set. Licensed translations (ESV via API) stay online-only with a clear "requires internet" state (see `docs/BIBLE_TRANSLATIONS.md`).
- **Safety:** cache is read-only fallback; edits still go to Supabase when online and are **queued** (Phase 2) when offline. Church-scoped keys. Never serve another church's cache.

### Phase 2 — Offline plan-edit safety
Two slices, in order of risk:

**2a — Honest offline guard (SHIPPED, 0.1.142).** Every plan-mutating handler in `PlaylistSection.tsx` (add-item, remove, reorder, duplicate, add-slide, section-theme) is wrapped in `blockedIfOffline()`: when `navigator.onLine === false` it shows *"You're offline — reconnect to change the service plan"* and no-ops the write instead of firing a server action that would fail silently and desync the local cache from Supabase. The present→project loop is untouched — projecting cached slides keeps working. This is the safe, correct-by-construction behaviour for a **live single-operator service**: a dropped signal can never scramble the plan mid-service.

**2b — Optimistic offline edit queue (DEFERRED, deliberately).** A full outbox that applies mutations to the local cache and drains on reconnect. Deferred because plan mutations are **order-dependent** (reorder + delete + add interleave), so a naive last-write-wins replay can corrupt a live plan — exactly the failure 2a exists to prevent. Only worth building if a church needs to *build* plans offline (not just *run* them), and then only with per-item version reconciliation, not blind replay. Not needed for JPD's live-service use case.

### Phase 3 — Electron shell resilience (COMPLETE — no DMG needed)
The **shell already boots offline and prefers local**, delivered by the existing `electron/main.ts` `loadWithRecovery()` (robust splash + infinite-retry offline boot, preserves BroadcastChannel/mic state) working together with the Phase 0 service worker (app-shell cache-first). Requirements below were satisfied without new native code:
- Cache the last-known-good app bundle in the shell — the SW app-shell cache serves the cached app when `PF_APP_URL` is unreachable.
- Electron-level offline boot + retry-with-backoff that swaps to the live app when it returns, **without reloading mid-service**.
- `output-fallback.html` remains the ultimate native fallback.
- **Result:** no new shell change → no DMG required for this phase. Any *future* shell change here would still follow `docs/DMG_RELEASE_SOP.md` and be version-gated so old shells are unaffected.

### Phase 3 (historical target — Electron shell resilience, needs a DMG)
Make the **shell itself** boot offline and prefer local.
- Cache the last-known-good app bundle in the shell (Electron `session` cache is already there; make the SW + HTTP cache headers cooperate so the shell serves the cached app when `PF_APP_URL` is unreachable).
- Add an Electron-level "offline mode" banner + a local health check; retry `PF_APP_URL` with backoff and swap to the live app when it returns — without reloading mid-service (preserve BroadcastChannel/mic state, per rule 8).
- Optionally bundle a minimal offline entry point in the shell as the ultimate fallback (beyond the current `output-fallback.html`).
- **Safety:** shell change → DMG (per `docs/DMG_RELEASE_SOP.md`). Gate any new behavior so an old shell is unaffected.

### Phase 4 — Degradation polish
- Clear, non-alarming "Offline — presenting from cache; AI paused" status in the operator.
- AI listening (Fly + Groq) shows "reconnecting"; the manual present loop is unaffected.
- Semantic search / sermon RAG disabled offline with a tooltip.

---

## Why this is safe for JPD's live services

- Every phase is **additive and inert when healthy** — online behavior is unchanged; the cache only kicks in on failure.
- The **present→project loop is already local** (BroadcastChannel); this plan extends resilience to cold-start + data, the two remaining network dependencies.
- Phases 0–2 ship via **Vercel** (no DMG). Phase 3 (shell resilience) turned out to be already satisfied by existing shell code — no DMG needed.
- Nothing here self-hosts or forks the data model — Supabase stays the source of truth.

## Recommended execution order
Phase 0 (SW app-shell) → Phase 1 (service cache) → Phase 4 (degradation UX) → Phase 2a (offline guard) → Phase 3 (shell resilience — already done). **Status as of 0.1.142: Phases 0, 1, 2a, 3, 4 all shipped.** Only Phase 2b (optimistic offline edit queue) remains, and it is deliberately deferred as unsafe/unnecessary for live single-operator services. Phases 0–1 deliver ~90% of the "runs offline" value with zero DMG and near-zero risk.

## Open decisions for the user
- Confirm the outage scenarios to optimize for (wifi drop mid-service vs. no-internet-at-launch vs. Vercel outage) — all covered, but priority order affects sequencing.
- Whether offline **editing** (Phase 2) matters, or offline **presenting** (Phases 0–1) is enough for now.
