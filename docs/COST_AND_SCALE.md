# Cost & scale — grow to 100 churches while spend goes DOWN

Researched 2026-09-21. Every figure is **VERIFIED** (source checked that day) or
**ESTIMATE**. Prices move — re-check before acting, per rule 4.

## The number that matters

Cost is driven by **Sunday audio minutes**, not by church count. Everything else
is roughly flat at our size.

| Churches | Audio min/mo (1×90min service/wk) | Deepgram @ $0.0077/min |
|---|---|---|
| 5 (today) | ~300 | ~$2 |
| 20 | 7,200 | ~$55 |
| 50 | 18,000 | ~$139 |
| 100 | 36,000 | ~$278 |

ESTIMATE, extrapolated from Deepgram's VERIFIED per-minute rate, no volume
discount assumed. **Even at 100 churches the STT bill is a few hundred a month.**
That reframes everything below: we are not in a cost crisis, so the right moves
are the ones that protect quality and avoid stupid spend, not heroic
re-engineering.

## What we run

| Component | Config | Cost |
|---|---|---|
| Fly audio bridge | 2× shared-cpu-1x / 2GB / `lhr`, always-on (`auto_stop_machines=off`) | ~$20–30/mo ESTIMATE — flat, does not scale with churches |
| Deepgram | streaming, `endpointing=100` | $0.0077/min VERIFIED |
| Groq LLM | `openai/gpt-oss-120b` → `openai/gpt-oss-20b` | $0.15/$0.60 per M tokens VERIFIED |
| Embeddings | MiniLM 384-dim, self-hosted | $0 marginal |
| Vercel | Fluid Compute, `dub1` | Active-CPU + **provisioned-memory while any instance is alive** VERIFIED |
| Supabase | Pro, eu-west-1, `max_connections=60` | $25/mo base + compute tier |

## Ranked moves

| Move | Saves | Risk | Effort | Quality |
|---|---|---|---|---|
| **Read the real dashboards** (Vercel invocations/memory, Fly machine-hours, Supabase compute tier + DB size) | Unknown — and that is the point. Every figure above is list-price extrapolation | None, pure measurement | Low | — |
| Right-size the Supabase compute tier | $0–35/mo | Must check, not guess | Low | None |
| Try **EmbeddingGemma-300M** vs MiniLM on real sermon queries | £0 | One-time re-embed of `sermon_chunks` | Medium | Likely **up** — MiniLM is now prototyping-grade |
| Fly scale-to-zero midweek | ~$20–30/mo | 🔴 Cold WebSocket at service start vs the `endpointing=100` requirement | Low | Risks the one thing we cannot regress |
| Second Fly region (Dublin) | — (costs more) | Only if peak data justifies it | Medium | DB is in Ireland; London↔Dublin is single-digit ms — measure first |
| Self-hosted Whisper for STT | 10×+ at high volume | 🔴 **Accent robustness unverified for Nigerian/RCCG English** | High | Could regress the core product for our actual users |

## Do now / at 20 / at 100

**Now** — measurement only. Pull the three dashboards. Confirm the 7-day
retention change's real storage delta.

**At 20** — run an accented-audio WER bake-off on *real Nigerian/RCCG service
recordings* before considering any STT change (rule 9). Evaluate EmbeddingGemma.
Instrument Sunday-peak concurrency on the bridge.

**At 100** — Supabase compute tier will not hold; revisit Fly machine count with
real peak data; only then consider queueing/regional placement.

## Rejected, and why

- **Self-hosting Whisper now.** Volume is far below where GPU idle economics
  work, and accent robustness for our users is unproven. General 2026 benchmarks
  show accented-speech WER of 30–50% vs 2–8% native on strong models. Rule 9
  says test against real accented transcripts, never idealised ones.
- **NVIDIA Parakeet** — trained predominantly on US English. Wrong user base.
- **Soniox** — cheapest per hour found (~$0.12/hr vs Deepgram ~$0.46/hr) but one
  comparison cites **53% WER on accented English**. Disqualifying at any price.
- **Fly scale-to-zero** — a ~$25/mo saving against a cold-start risk on the first
  minute of a service. Wrong trade.
- **Hosted embedding API** — local embeddings are free and working.

## Correction recorded

The research pass flagged "Groq deprecated llama-3.3-70b — possible live
outage". **Verified against the live API: the code was already migrated** to
`openai/gpt-oss-120b` and both models return 200. What was stale was the
*documentation* — `CLAUDE.md` rule 6 and the comments in `ai-helpers.ts`, now
fixed. A textbook rule-4 case: an artifact raised an alarm the source disproved.

## Measurements we do not have

Actual Vercel invocation/memory profile · actual Fly billed machine-hours ·
actual Supabase compute tier and DB size · actual audio-hours/month · real
token counts per service. **Nothing here should be treated as a budget until
those are read.**
