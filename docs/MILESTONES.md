# Milestones & locked behaviour

**Update this file as part of the work, not afterwards.** Any agent that ships
something, or is told a thing works, appends here in the same change. A stale
version of this file is worse than none — it is how agents end up "remembering"
a system that no longer exists.

Two sections:

- **Locked** — confirmed working, usually on real hardware. Touching the listed
  files is a regression risk. See rule 1 in [`AGENTS.md`](../AGENTS.md).
- **Log** — what shipped, newest first, with the rollback.

---

## Locked behaviour — do not regress without explicit sign-off

| Confirmed | What | Files | Covered by |
|---|---|---|---|
| _(none yet)_ | Add the first entry the moment the owner says a thing works | | |

> How to add one: the owner says "X works perfectly" → append the date, what
> exactly was confirmed, the files that make it work, and the test that pins it.
> If no test pins it, write one.

---

## Infrastructure — the truth as last verified

Verified **2026-09-21**. Re-verify with the command shown; do not trust this
table if it is more than a few weeks old.

| Thing | State | How to check |
|---|---|---|
| Fly audio bridge | **2 machines**, `damp-moon-2740` + `shy-meadow-3274`, both `started`, both `shared-cpu-1x:2048MB`, both `lhr` | `fly machines list -a faithflow-audio` |
| Fly redundancy | Machine-level **yes**. Region-level **no** — both in `lhr` | as above |
| Vercel | Fluid Compute **ON**, elastic concurrency ON, region `dub1`, Node 24 | Vercel project API `defaultResourceConfig` |
| Supabase | **Pro** plan | Supabase dashboard |
| Supabase DB | `mdjdemrtykflfucggbqt` "PresentflowAPP", **eu-west-1 (Ireland)**, PG 17 | Supabase MCP `list_projects` |
| Connection pooling | **Supavisor (the pooler) IS in use** — confirmed via `pg_stat_activity`. `max_connections = 60` (57 usable) | `select * from pg_stat_activity` |
| Indexes | `idx_transcript_segments_plan_ts` + `idx_detected_references_segment` **created & valid 2026-09-21** | `pg_index.indisvalid` |
| Transcript retention | **7 days**, all 9 churches. Prune still DRY RUN (`PRUNE_TRANSCRIPTS_ENABLED` unset) | `select transcript_retention_days...` |
| Redis / Upstash | **NOT provisioned.** Code is ready (`src/lib/rate-limit-redis.ts`) and inert until `UPSTASH_REDIS_REST_URL` + `_TOKEN` are set. `RATE_LIMIT_BACKEND` remains a dead env var | `vercel env ls production` |
| Uptime monitoring | UptimeRobot (owner-managed, external) + Sentry + PostHog + `/api/health*` | — |
| Warm/cold latency | ~0.1–0.5s warm; **~24s** cold on a freshly deployed instance | `curl -w '%{time_total}'` |

---

## Log

### 2026-09-21 — Scale hardening for 20+ churches (PR #96, open)
- Audio bridge: added `unhandledRejection` / `uncaughtException` guards. One
  church's failed DB write could previously kill live audio for **every** church.
- `transcript_segments` + `detected_references`: added the two missing indexes
  (`CONCURRENTLY`). The table had none and is the fastest-growing in the schema.
- Retention: wired the nightly prune that had **never run in production**.
  **Dry-run by default** — deletes nothing until `PRUNE_TRANSCRIPTS_ENABLED=1`.
- Retention default **90 → 7 days** (owner directive). Sermon summaries and the
  sermon search index are separate tables and are never pruned.
- `fly.toml` matched to reality: `min_machines_running` 1 → **2**, memory
  512MB → **2048MB**. The file had drifted *below* the live machines; deploying
  it would have halved a live bridge's memory and risked dropping redundancy.
- `docs/SCALING_AUDIT.md` committed with a verified status table (it had only
  ever existed as an untracked file).

### 2026-09-21 — Backgrounds are a real layer (PRs #93, #95 — live)
- Slides are a transparent text layer; the opaque black moved to the output
  surface (ProPresenter's Screen Color model). Kill switch
  `NEXT_PUBLIC_TRANSPARENT_SLIDE` / localStorage `presentflow.transparentSlide.v1`.
- `bgExplicit`: a slide records that its background was **chosen**, so a
  deliberate black paints instead of reading as the unset DB default. Retired
  the `#010101` sentinel. Rows without the flag keep the old behaviour exactly.
- Follow-up (#95) fixed five paths that copied a background but dropped the
  marker, plus a "Clear colour" control and an editor-only transparency
  checkerboard.
- Rollback: `vercel promote faithflow-3lbe2loyz-benjamin-sanusis-projects.vercel.app`
- **Field verification on a real projector: still outstanding.**

> Older history lives in `changes/*.md` (What's New) and the memory index at
> `~/.claude/projects/-Users-benjisanusi-faithflow-ai/memory/MEMORY.md`.
