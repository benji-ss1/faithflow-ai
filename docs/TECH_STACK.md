# PresentFlow — Tech Stack (source of truth)

_Last updated: 2026-08-16 · app version `0.1.230` · pulled from `package.json`, `fly.toml`, `native/macos/`._

PresentFlow is a live worship-presentation system for churches (JPD / RCCG, Dublin).
Mental model: an **Electron desktop shell** loads the **Vercel-hosted Next.js operator
console**; live audio streams to a **Fly.io WebSocket server** running **Deepgram** ASR →
Bible/song **parser** → detections flow back to the operator, who pushes content to the
projector / stage / livestream windows over **BroadcastChannel**. **Supabase
Postgres + pgvector** holds all church-scoped data; **Groq** powers AI.

---

## Languages

| Language | Where | Written by |
|---|---|---|
| **TypeScript 5.7** | Everything — renderer, Electron main/preload, server actions, audio server. Strict; `tsc --noEmit` is the gate. | us |
| **TSX / JSX** | React components | us |
| **SQL (via Drizzle)** | Postgres schema + queries | us |
| **Swift** | `native/macos/` — the native macOS audio helper (CoreAudio + NDI) | us |
| **C (tiny shim)** | `native/macos/Sources/CNDI/shim.c` — bridges the NDI SDK into Swift | us |
| **Bash** | `scripts/*.sh` — release / build / deploy | us |

**We do NOT write C++.** The only C++ present is inside **vendored SDK headers**
(`native/macos/Sources/CNDI/include/Processing.NDI.*.h`, shipped by NewTek/NDI) and inside
third-party compiled binaries (Electron, ffmpeg, etc.). We interop with NDI through a thin
**C** shim, not C++.

Script executor: **`tsx`** (TypeScript-execute) runs all Node-side scripts directly.

---

## App shell / desktop

- **Electron 43** — thin-client desktop shell. `main: dist-electron/main.js`. The shell loads
  the **hosted Vercel URL** — it is a thin client, not a bundled app.
- **electron-builder 26** — packaging (macOS `.dmg`, arm64 + x64; Windows nsis).
- **electron-updater 6** — auto-update via `latest-mac.yml` on GitHub Releases.
- Currently **unsigned / unnotarized**; installed with `xattr -cr`.
- **Ship rule:** renderer changes → Vercel (operators reload with ⌘⇧R). Only Electron-layer
  changes need a new DMG.

---

## Native macOS audio helper (`native/macos/`)

- **Swift Package** (`Package.swift`), built with SwiftPM/Xcode → binary `PresentFlowAudioHelper`.
- Does **Tier 1** high-accuracy audio capture: device enumeration, channel probing, and
  **NDI** network-audio receiving (pulls audio off a sound desk / NDI source).
- Talks to Apple's NDI SDK through a small **C shim** (`Sources/CNDI/shim.c`).
- Electron shells out to this binary; fallback tiers are ffmpeg (C, prebuilt) and browser
  `getUserMedia` — neither of which requires hand-written native code.

---

## Frontend

- **Next.js 15.1** (App Router) + **React 19** / React DOM 19.
- **Tailwind CSS 4 (beta)** via `@tailwindcss/postcss`; **lightningcss** for CSS.
- **Radix UI** primitives — dialog, context-menu, popover, tabs, tooltip, dropdown,
  alert-dialog, avatar, label, slot.
- **lucide-react** (icons), **sonner** (toasts), **cmdk** (command palette),
  **class-variance-authority + clsx + tailwind-merge** (styling utils).
- **dnd-kit** (core / sortable / utilities) — playlist & slide drag-and-drop.
- **@napi-rs/canvas** (Rust under the hood) — canvas text measurement for the auto-fit engine.
- Import/parsing: **pdfjs-dist**, **libreoffice-convert**, **adm-zip / fflate** (PPTX /
  ProPresenter), **fast-xml-parser**, **isomorphic-dompurify** (sanitize).

---

## Sync / live output

- **BroadcastChannel** — PRIMARY same-machine, zero-latency sync (projector / stage /
  livestream windows). Canonical path (CLAUDE.md rule 8).
- **Electron main-process IPC relay** (`pf:live`) — cross-window relay in the desktop shell.
- **Supabase Realtime** — additive cross-device fan-out only; never replaces BroadcastChannel.

---

## Backend / data

- **PostgreSQL** (Supabase-hosted) with **pgvector** — Bible library, songs, sermon RAG
  chunks, church-scoped multi-tenant data.
- **Drizzle ORM 0.36** + **drizzle-kit** — schema (`src/lib/db/schema.ts`), migrations,
  studio. `church_id` FK on every tenant-owned table.
- **`pg`** driver.
- **Next.js Server Actions** (`src/lib/actions.ts`) — all writes, auth-gated + church-scoped.
- **Supabase** (`@supabase/supabase-js`) — DB + Storage + Realtime.
- **Storage** — S3-compatible via **AWS SDK v3** (`@aws-sdk/client-s3`, lib-storage,
  s3-request-presigner).

---

## Audio / transcription pipeline (real-time core)

- **Fly.io** WebSocket bridge — `scripts/audio-server.ts`, app **`faithflow-audio`**, region
  **`lhr`** (London), internal port **3001**. Separate from Vercel.
- **`ws`** — WebSocket transport.
- **Deepgram SDK 5** — live streaming ASR (`endpointing=100`, interim + final, keyterms, VAD).
  Predictive early-fire on interims for low latency (CLAUDE.md rule 10).
- **`ffmpeg-static`** — audio capture/transcode fallback tier.
- **Bible parser** (`src/lib/bible-parser.ts`) — accent/ASR-hardened (TH-fronting repair,
  fuzzy book match, homophone repair — e.g. "Trever → 3 verse"). Runs on the Fly server, so
  parser changes require a **Fly redeploy** to go live.

---

## AI

- **Groq is the only AI provider** (CLAUDE.md rule 6), via `src/lib/ai-helpers.ts`:
  - Primary: **llama-3.3-70b-versatile** (quality)
  - Fallback: **llama-3.1-8b-instant** (rate-limit relief)
  - Graceful degradation when the key is missing; no other providers without sign-off.
- **@xenova/transformers** (~90MB) — local embedding model for **sermon RAG** (server-side
  ingestion only; chunk + embed transcripts into pgvector).

---

## Auth / security / billing

- **NextAuth v5 (beta)** — auth.
- **bcryptjs** (password hashing), **otplib** (TOTP 2FA).
- **Stripe 22** — billing/subscriptions (web app = admin / billing / upsell only).
- **Resend** — transactional email.
- **zod** — validation; **server-only** — enforce server/client import boundary.

---

## Testing / quality / monitoring

- **Playwright 1.61** — E2E / browser.
- **Adversarial test suite** (`test/adversarial/`) — cross-church leakage + prod invariants;
  run before every ship. Plus custom Bible parser / homophone / completeness suites.
- **ESLint 9** + `eslint-config-next`.
- **@sentry/nextjs** — error monitoring; **@vercel/analytics** + **@vercel/speed-insights**.

---

## Deploy topology (3 targets)

| Layer | Platform | Trigger |
|---|---|---|
| Next.js web app (renderer) | **Vercel** | `git push` to `main` → auto-deploy |
| Audio / transcription bridge | **Fly.io** (`faithflow-audio`, lhr) | `./scripts/deploy.sh audio` / `flyctl deploy` |
| DB + Storage + Realtime | **Supabase** (Postgres + pgvector + S3) | migrations via drizzle-kit |
| Desktop shell | **GitHub Releases** (electron-updater) | `.dmg` build → publish |

---

## "Native under the hood" (dependencies we don't write)

- **Electron / Node / V8** — C++ (the runtime itself)
- **@napi-rs/canvas** — Rust (text measurement)
- **ffmpeg-static** — C (prebuilt binary)
- **pg / bcrypt** — some native bindings
- **NDI SDK** — C / C++ headers (vendored), reached via our C shim

**Bottom line:** we write **TypeScript** for ~everything and **Swift + a little C** for the
macOS native-audio helper. No hand-written C++.
