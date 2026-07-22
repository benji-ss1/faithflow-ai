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

9. **Speech→scripture must handle African-preacher accents and ASR mishearings, not just clean input.** The user base is African (largely Nigerian/RCCG) churches; test the parser against real accented transcripts, never idealized text. `src/lib/bible-parser.ts` owns this: (a) `repairNumberHomophones()` fixes TH-fronting (Deepgram hears "three"→"tree", "third"→"tird", "thirty"→"tirty", "thousand"→"tousand") BEFORE any number pattern runs — extend it, with a guard, when new mishearings surface (e.g. "tree" is skipped before "of" so "tree of life" isn't read as "3"); (b) `fuzzyBookMatch()` (edit-distance) catches near-miss book names ("filippians", "corintians", "ecclesiastis") and is wired into live parsing via the `fuzzy_book_ch_verse` pattern — gated to a chapter:verse shape + low confidence + semantic fallback so it can't false-fire on ordinary speech. All 66 books must always resolve via `knownBook()` (there's a coverage check pattern in the parser tests). When a real transcript reveals a miss, fix it case-by-case AND consider whether it's a systematic accent pattern worth a general rule.

10. **AI-detection latency is a product requirement: detections must track live speech, not lag it.** The predictive path lives in `scripts/audio-server.ts`'s interim handler: it early-fires an `interim_final_candidate` the moment an interim already parses to a reference (`parseReferences(text).length > 0`, gated by a cheap numeric pre-check to keep the hot path lean) OR clears a loosened generic gate (≥3 words, ≥0.75 confidence), rather than waiting for Deepgram's finalized utterance (~200ms endpointing + network). Don't raise those gates without cause; if anything, push detection earlier. Keep `endpointing=200` (10ms was tried and was far too aggressive — it split utterances). Client dedupes interim candidates against the eventual final by reference key.

11. **Sermon-search RAG (chunk-level) ingestion runs SERVER-SIDE ONLY.** `src/lib/server/sermon-rag.ts` chunks + embeds transcripts into `sermon_chunks` (pgvector, church-scoped). The embedding model (`@xenova/transformers`, ~90MB) does NOT load in every dev environment, so ingestion cannot be verified locally — it runs via `after()` on live-session end, the admin `POST /api/sermon/backfill` (paste a past transcript), and the daily `/api/cron/backfill-sermons` cron (drains any plan with segments-but-no-chunks; bounded + idempotent). Never bulk-import scraped/ASR lyric text as song content, and never hardcode transcripts (esp. worship lyrics) into the repo — load historical transcripts through the backfill route.

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
