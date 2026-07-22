# CLAUDE.md — Working standard for AI-assisted work on this repo

Before you make any non-trivial change, read [docs/AGENT_WORKFLOW.md](docs/AGENT_WORKFLOW.md).

## Non-negotiables

1. **The loop is the standard.** Plan → Build → Review → Fix → Re-test → Ship → Report. Skipping steps produces provisional work, not done work.

2. **Three review agents, always, in parallel** for anything > 100 LOC or touching auth, data, church_id, AI, or output channels: reviewer + security + stress. Spawn them in one message with `run_in_background: true`. Full prompt templates in `docs/AGENT_WORKFLOW.md`.

3. **Every finding must be tagged 🔴/🟡/🟢.** No unranked prose. No soft passes.

4. **Every checkpoint gets a status block.** Copy the template from `docs/AGENT_WORKFLOW.md#checkpoint-template`. If you can't fill in a field, that step isn't done.

5. **Church_id scoping is mandatory** on every DB write and every semantic/vector query. Only exception: the Bible library, documented in `src/lib/server/bible.ts:12-17`. New paths need an adversarial test in `test/adversarial/`.

6. **AI provider is Groq** (llama-3.3-70b-versatile) via `src/lib/ai-helpers.ts`. Graceful degradation when key missing. No fallbacks to other providers without explicit sign-off.

7. **Songs auto-project ONLY at ≥85% AI-detection confidence** (`SONG_AUTOLIVE_CONFIDENCE` in `ProOperatorShell.tsx`) — explicit product-owner-approved policy, 2026-07-22, accepting the copyright risk at that confidence tier. Below 85%, a human confirm keypress ("G") is required; nothing below `SONG_STAGE_CONFIDENCE` (60%) does anything but sit as a passive chip. Auto-live at ≥85% carries the same anti-replay/min-gap guardrails as Bible's AUTO-approve path (session-persisted fired-key map, min-gap cooldown). Do not lower either threshold or extend zero-click auto-project to other content types without new explicit sign-off — this is a narrow, documented exception, not a general precedent.

8. **Same-machine BroadcastChannel is the primary sync path.** Supabase Realtime is additive fan-out. New sync features must preserve the same-machine zero-latency path.

## Where things live

- `docs/AGENT_WORKFLOW.md` — the loop + agent prompts + checkpoint template
- `src/lib/db/schema.ts` — Drizzle schema; church_id FK on every tenant-owned table
- `src/lib/server/*` — server-only helpers; import boundary between DB and routes
- `src/lib/ai-detection/*` — unified detection engine (P5A); no web lyric scraping
- `src/lib/realtime.ts` — cross-device output channel
- `src/lib/broadcast.ts` — BroadcastChannel same-machine primitive
- `src/lib/actions.ts` — every server action; auth-gated + church-scoped
- `test/adversarial/` — cross-church leakage + prod invariants; run before every ship
- `scripts/audio-server.ts` — Fly.io-hosted WebSocket bridge (not Vercel)

## Deploy runbook

- Next.js app → Vercel (git push to main triggers auto-deploy)
- Audio bridge → Fly.io (`./scripts/deploy.sh audio`)
- DB + Storage → Supabase (Postgres w/ pgvector + S3-compatible storage)
- See `DEPLOY.md` for the full runbook.

## When you hit unknowns

- Missing hardware (mic, projector, mixer): document as untestable, do NOT claim tested.
- Missing external service (Fly not up, Groq key missing): document as known gap; prove graceful degradation.
- Missing acceptance criteria in the ask: state them explicitly BEFORE running. No retroactive softening.
