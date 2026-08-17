# PresentFlow — AI Session Handoff & Working Guide

_Read this at the start of every PresentFlow session. It's the fast onboarding for any AI terminal: how this repo ships, how work is done here, the current state, and the traps. Pairs with `CLAUDE.md` (the rules) and `docs/AGENT_WORKFLOW.md` (the loop)._

_Last updated: 2026-08-17._

---

## 1. What PresentFlow is (30 seconds)

Live worship-presentation app for churches (primary church: **JPD**, RCCG, Dublin). It's a **thin-client Electron desktop shell** that loads the **hosted Vercel Next.js app** (`faithflow-ai.vercel.app`). Live audio → **Fly.io** WebSocket server → **Deepgram** ASR → a **Bible/song parser** → detections → operator approves → projector/stage/livestream via **BroadcastChannel**. Data in **Supabase Postgres + pgvector**. AI = **Groq**.

Full stack: `docs/TECH_STACK.md`. Architecture + scaling: `docs/ARCHITECTURE_REVIEW.md`.

---

## 2. THE DEPLOY MODEL — read this before asking "do I need to ship a DMG?"

This is the single most important operational fact. Three deploy targets, and **most changes do NOT need a DMG:**

| You changed… | Ships via | How operators get it | DMG? |
|---|---|---|---|
| **Renderer** (React/Next under `src/`, incl. `src/lib/changelog.ts`) | **`git push` → Vercel** | reload the app (**⌘⇧R**) | ❌ NO |
| **Electron shell** (`electron/`, `native/`) | **new signed DMG** → GitHub Releases → electron-updater | app auto-updates / reinstall | ✅ YES |
| **Bible/song parser or audio server** (`src/lib/bible-parser.ts`, `src/lib/song-parser.ts`, `scripts/audio-server.ts`) | **Fly** (`flyctl deploy --app faithflow-audio --now`) — the parser runs ON the Fly bridge | live immediately | ❌ (Fly, not DMG) |

**Desktop-first rule:** default work target is the Electron operator shell. The web app is admin/billing/upsell only — don't build operator/AI/live features on web unless explicitly asked.

**Practical upshot:** ~90% of work here is renderer → Vercel → reload. A DMG is only for `electron/` changes. Before cutting a DMG, read `docs/DMG_RELEASE_SOP.md` (and the memory `ref_presentflow_dmg_sop`). `flyctl` is at `~/.fly/bin/fly`.

---

## 3. How work is done here (the loop — non-negotiable)

**Plan → Build → Review → Fix → Re-test → Ship → Report.** Full spec in `docs/AGENT_WORKFLOW.md`, rules in `CLAUDE.md`. In practice each session:

1. **Explore first.** Use parallel Explore/subagents to map the code before changing it — don't guess file:line.
2. **Build** the smallest correct change; `npx tsc --noEmit` after every edit (grep the output for your files — the repo has stray `.claude/worktrees/*` copies that pollute a raw typecheck; filter them out).
3. **Review with 3 agents IN PARALLEL** for anything >100 LOC or touching **auth / data / church_id / AI / output channels**: `reviewer` + `security` + `stress`, spawned in one message, background. Every finding tagged 🔴/🟡/🟢. No soft passes. This has repeatedly caught real bugs (a dead `churchId`, poison-pilling, partial-chapter poisoning) BEFORE shipping — trust it, and **don't ship 🔴s**.
4. **Fold in findings**, re-typecheck.
5. **Changelog entry** in `src/lib/changelog.ts` (top of the array, bump the patch version) for every substantial, operator-facing change — the "What's New" modal is testers' only surface. Keep highlights about what THEY see.
6. **Ship:** commit **specific files** (see traps), `git pull --rebase --autostash`, `git push`. Report what shipped + how to get it (reload vs DMG).

**When a change is risky/hazardous, don't ship it — say so.** Example this session: a write-behind queue was fully built, the 3-agent review found 3 live-service hazards, so it was **reverted, not shipped.** "Sunday is sacred" > shipping a half-safe feature.

---

## 4. Traps & conventions (learned the hard way)

- **NEVER `git add -A`.** Commit specific files by path. Changelog merge conflicts happen constantly — rename your entry to the next free version.
- **`churchId` is NOT on `plan`/`ExpandedPlan`.** Reading `(plan as {churchId})` gives `undefined` — this silently broke tenant scoping in several places. Thread it as a real prop from `user.churchId`.
- **Electron has no `window.prompt`/`confirm`.** Use inline modals in the renderer.
- **BroadcastChannel is the PRIMARY same-machine sync** (CLAUDE.md rule 8). The `/live` `/stage` `/livestream` windows are pure clients fed by it + a main-process `pf:live` IPC relay. Supabase Realtime is additive fan-out only.
- **Groq is the only AI provider.** Deepgram is ASR, Supabase is the DB — don't switch these.
- **API.Bible is a shared 5k/month platform key.** NEVER bulk-download licensed translations (NIV/NKJV/NLT) — it destroys the quota for every church. Public-domain Bible text is local Postgres; licensed is fetched per-chapter on demand.
- **Parser must handle African-preacher accents/ASR mishearings** (CLAUDE.md rule 9) — extend `repairNumberHomophones()` with a guard when a real transcript reveals a miss (e.g. "Trever"→"3 verse", "machu"→"Matthew").
- **AI-detection latency is a product requirement** (rule 10). Don't raise Deepgram `endpointing` (100ms, field-tuned) or the interim early-fire gates.
- **I can't drive the Electron app or test offline behavior headlessly** — Playwright/Chrome tools target browsers, not the Electron shell. Visual/offline checks need the user's on-device test (⌘⇧R to reload).

---

## 5. Current major initiative: OFFLINE-FIRST (the big epic)

Goal: run a whole service through a venue-wifi drop. Progressive-bundling approach (critical path local, admin remote). Full plan: `docs/ARCHITECTURE_REVIEW.md`; live status in memory `reminder_presentflow_local_first`.

| # | Piece | Status | Files |
|---|---|---|---|
| — | Projection offline | ✅ was always (BroadcastChannel) | `src/lib/broadcast.ts` |
| 1 | Graceful degradation (honest degraded-mode UI) | ✅ shipped | `src/lib/connection/connectionHealth.ts`, `src/components/system/ServiceModeBanner.tsx` |
| 2a | Persistent Bible chapters (survive reload/offline) | ✅ shipped | `src/lib/offline/bibleOfflineStore.ts`, `src/lib/bible-chapter-cache.ts` |
| 2b | Full-Bible offline (all public-domain; licensed on-demand) | ✅ shipped | `src/app/api/bible/full/route.ts`, `src/lib/offline/bibleHydration.ts` |
| 3 | Plan snapshot restore (offline) + churchId/tenant fixes | ✅ shipped | `src/lib/offline/serviceCache.ts`, `OperatorConsole.tsx` |
| — | Edits offline | 🔒 honestly BLOCKED (`blockedIfOffline()` toast) — safe + consistent | `PlaylistSection.tsx` |
| 5 | Write-behind queue | ⛔ built then REVERTED (3 live-service 🔴s). If ever needed → do as **local-first (local DB + sync)**, NOT a bolt-on outbox | — |
| **4** | **Offline LAUNCH — Electron-level cache** | ⏭ **NOT built** — needs a signed DMG. Plan: `docs/INCREMENT_4_ELECTRON_CACHE_PLAN.md` | `electron/main.ts` |

**Offline data layer that exists** (three separate IndexedDB DBs, all best-effort/never-throw): `presentflow-bible` (verse chapters + hydration manifest), `presentflow-offline` (service snapshot + theme KV), and the connection-health store. Reuse these; don't reinvent.

---

## 6. Operational flags (user's side — surface these, don't fix in code)

- ⚠️ **Deepgram: Pay-As-You-Go, ~$120 credit, NO card on file + auto-reload OFF, ~$40/week burn (~3 weeks).** When it hits $0 every church loses AI mid-service. User needs to add a card + enable auto-reload.
- 💡 **Diarization ≈ 24% of Deepgram spend** and IS used (`useAudioStream.ts` filters non-primary speakers). Keep if the mic picks up the room; drop (`diarize:false` + Fly redeploy) to save ~¼ if the pulpit mic is clean.
- **Deepgram PAYG concurrency ~50 streams** — fine to ~40–50 concurrent churches; Growth/Enterprise beyond.
- **Fly: 2×`shared-1x@512MB` LHR.** Recommend bump to 1GB (~+$4/mo). Single region — add regions only when churches spread beyond the UK/EU.
- **NOT Apple-enrolled yet** (user is doing it). Blocks the signed DMG + auto-update → gates increment 4 and general adoption (removes the `xattr -cr` install step).

---

## 7. Where to look

- `CLAUDE.md` — the rules (church_id scoping, Groq, song/Bible thresholds, endpointing).
- `docs/AGENT_WORKFLOW.md` — the loop + 3-agent prompt templates + checkpoint template.
- `docs/ARCHITECTURE_REVIEW.md` — offline/scaling audit + roadmap.
- `docs/TECH_STACK.md` — full stack.
- `docs/DMG_RELEASE_SOP.md` — before any DMG.
- Memory index: `~/.claude/projects/-Users-benjisanusi/memory/MEMORY.md` (load PresentFlow entries at session start).
