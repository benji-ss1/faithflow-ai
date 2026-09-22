# Scaling audit — can PresentFlow carry 20+ churches?

> **Target:** 20+ churches running services **at the same time** on a Sunday morning.
> Original audit 2026-09-09 (25 findings, below). **Re-verified against `origin/main`
> on 2026-09-21** — the raw findings were never committed and several had moved, so the
> status table is the source of truth; the original text is kept underneath for detail.

## Status as of 2026-09-21 (verified, not assumed)

| # | Finding | 2026-09-09 | 2026-09-21 verified | Where |
|---|---|---|---|---|
| 1 | Audio bridge can be killed by ONE church's unhandled rejection | CRITICAL | **FIXED** — process-level guards added | `scripts/audio-server.ts` |
| 2 | `transcript_segments` had **zero** indexes; cascade FK unindexed | HIGH | **FIXED** — 2 indexes + `CONCURRENTLY` migration | `schema.ts`, `docs/migrations/2026-09-21-scale-indexes-transcripts.sql` |
| 3 | Retention prune never ran in production (script existed, nothing invoked it) | HIGH | **FIXED** — nightly cron, **dry-run by default** | `src/lib/server/transcript-retention.ts` |
| 4 | Fly machine "1 shared vCPU / 512MB" | CRITICAL | **WAS ALREADY FIXED IN REALITY** — live machines are `shared-cpu-1x:2048MB`. `fly.toml` had drifted BELOW reality and is now pinned to match | `fly.toml` |
| 5 | Shared 6-connection pg pool | CRITICAL | **PARTLY** — 2→6 + timeouts; still one pool per instance | `src/lib/db/client.ts` |
| 6 | No uptime monitoring / paging | CRITICAL | **MOSTLY FIXED** — UptimeRobot (owner-managed) + Sentry + PostHog + `/api/health*`. Paging still unconfirmed | — |
| 7 | "Fly = ONE machine" | CRITICAL | **WRONG — there are TWO** (`damp-moon-2740`, `shy-meadow-3274`, both started, both `lhr`). Machine SPOF is GONE. **Region SPOF remains** — both in London | `fly machines list -a faithflow-audio` |
| 8 | No staging; push to `main` auto-deploys mid-service | CRITICAL | **STILL TRUE** — CI only lints/typechecks | `.github/workflows/ci.yml` |
| 9 | Rate limiters are per-instance memory | HIGH | **STILL TRUE** — and **no Redis/Upstash exists**. `RATE_LIMIT_BACKEND` is set in Vercel but nothing in `src/` reads it — a dead env var | `src/lib/rate-limit.ts` |
| 10 | RLS enabled with no policies; app connects as owner → isolation is app-layer only | MEDIUM | **STILL TRUE** (deliberate, documented). **A real implementation already exists** — see "Salvaged from PR #1" below | `docs/migrations/2026-08-18-enable-rls-security-lockdown.sql` |
| 11 | ~12 adversarial cross-church tests excluded from CI (need a DB) | — | **STILL TRUE** — incl. `cross-church.test.ts` itself | `test/suites/known-failing.txt` |
| 12 | **`DATABASE_URL` port unknown** — 6543 pooler vs 5432 direct | — | **UNVERIFIABLE from code** (write-only secret). **Check this first.** | Supabase dashboard |

### The one that decides everything: #12

At 20 churches, expect roughly **60–120 concurrent Postgres connections**
(demand-driven Fluid instances × `max: 6` per pool).

Supabase is on the **Pro** plan (confirmed by the owner), which raises the ceiling
but does not remove the distinction:

* On the **transaction pooler (6543)** PgBouncer multiplexes these onto few server
  connections — fine.
* On a **direct connection (5432)** this exceeds typical Supabase limits and produces
  hard `too many connections` errors during simultaneous Sunday services — an **outage**,
  not a slowdown.

**How to tell without reading the secret:** Supabase → Database → Connection Pooling,
and watch which counter climbs during a live service. Or check `pg_stat_activity` for
the pooler's proxy IP vs direct client addresses.

### Ranked, before onboarding 20 churches

1. **Confirm the DB port (#12).** Free, zero code, decides whether #5 is a fire.
2. **Apply the index migration (#2).** Additive, zero risk, biggest single query win.
3. **Read the prune dry-run numbers, then arm it (#3)** with `PRUNE_TRANSCRIPTS_ENABLED=1`.
4. **Region redundancy (#7)** — two machines already exist, but both are in `lhr`.
   A second REGION is the remaining SPOF. Weigh against latency: churches are
   UK/Nigeria, and Deepgram round-trips are latency-sensitive (rule 10).
5. **Shared rate-limit backend (#9)** — the seam (`setRateLimitBackend`) already exists.
6. **CI Postgres service container (#11)** so cross-church tests actually run.
7. **External uptime prober + paging (#6)** — the cheapest way to stop finding out
   from a church that Sunday is broken.

### Salvaged from PR #1 (closed 2026-09-22, 1,690 commits stale)

PR #1 "Admin Portal Phase 1" sat open since 2026-07-12. Its **auth hardening
landed independently** — `src/lib/auth.ts` on main already has the constant
dummy-bcrypt compare that defeats timing enumeration, and login rate limiting.
So that half is done, by other means.

Its **RLS half was never done and is still the real gap (#10)**. Worth reviving
as its own piece of work, not as that branch:

- `drizzle/0001_rls.sql` — actual POLICIES on 25 tenant tables + `auth_tokens`.
  Main only has the 2026-08-18 lockdown, which enables RLS with **no policies**
  and is bypassed by the owner role, so it contributes nothing to tenant
  isolation.
- `src/lib/db/rls.ts` — `withChurchScope` / `withServiceRole` helpers. **Not on
  main.**
- `test/adversarial/rls-cross-church.test.ts` — passed 5/5 against a NON-OWNER
  role. **Not on main.** Note that `test/adversarial/cross-church.test.ts` is
  currently in `known-failing.txt` because CI has no Postgres, so this is the
  suite we most want running and least have.

Recover the content with `git show origin/admin-portal-v2:<path>` — the branch is
kept, not deleted. Do NOT try to merge that branch: it also rewrites `auth.ts`,
`login/page.tsx`, `signup/page.tsx` and `OnboardingWizard.tsx`, all of which have
moved on substantially in 1,690 commits.

### What is NOT a scaling problem (measured 2026-09-21)

* Fluid Compute is **already ON** with elastic concurrency, region `dub1`.
* Warm response is **~0.1–0.5s**. Cold start on a freshly deployed instance measured
  **~24s** — which is why a deploy shortly before a service is felt by real operators.
* The app is not slow. A same-day report of "not loading" was a post-deploy cold fleet
  plus a poor venue connection: `vercel.com` measured 4.2–5.0s from the same laptop
  while `presentflow.org` measured 1.0–4.4s.

---

## Original audit (2026-09-09) — full findings, kept for detail

==================== confirmed 23

--- [CRITICAL] (tenancy) Fly audio bridge shares ONE 6-connection pg pool across all live services — hard bottleneck on Sunday morning
FILE: scripts/audio-server.ts:175 (getDb) + src/lib/db/client.ts:29 (max:6)
DETAIL: The long-running Fly bridge imports the same getDb() as Vercel (scripts/audio-server.ts:21,175), which builds a single pg Pool with max:6 (client.ts). One bridge process (memory: '1 machine') serves EVERY church's live audio. Each finalized utterance drives multiple serial writes through that pool: insert transcriptSegments (audio-server.ts:962), insert detectedReferences (:1083), insert aiSuggestions (:1247/:1270), plus churchPreferences/song-library reads and semantic-search round-trips. During a 2-3h sermon a church fires several detections 
IMPACT: 5 churches: bursts of concurrent detections queue on 6 connections; occasional 'Verse lookup timed out'. 10 churches: sustained contention, detections lag live speech (violates CLAUDE.md rule 10). 20 churches simultaneously mid-sermon: dozens of writes/sec funnel through 6 shared connections with no per-church fairness — the bridge becomes the sing
FIX: Give the bridge its own dedicated Pool sized for concurrent-service count (or one pool per N churches), separate from the Vercel request pool; batch/queue transcript inserts per church; confirm DATABASE_URL uses Supabase pooler transaction mode (6543) so raising max doesn't exhaust Postgres. Load-test at 20 concurrent simulated services before onbo
VERDICT: True - Core claim CONFIRMED but two read-side details are imprecise: (1) churchPreferences and song-library reads are NOT per-utterance — both are 5-min in-memory cached (audio-server.ts:310-337, getPrefs/getSongLibrary), added precisely to remove that per-segment query, so steady-state read pressure is much lower than stated. (2) Semantic-search round-trips do NOT use the pg pool at all — since the 2026-07-24 refactor they are off-bridge HTTP calls to 

--- [HIGH] (tenancy) transcript_segments grows unbounded — retention prune exists but is NOT wired into any cron
FILE: scripts/prune-transcripts.ts + vercel.json (crons)
DETAIL: The Fly bridge inserts one transcript_segments row per finalized utterance during every live service (audio-server.ts:962), plus cascading detected_references (:1083). A prune job exists (scripts/prune-transcripts.ts, honoring churchPreferences.transcriptRetentionDays default 90) and an npm script 'cron:prune-transcripts', but vercel.json only schedules warm-embeddings and backfill-sermons. Nothing invokes the prune automatically — no Vercel cron, no GitHub Action. The retention setting shown in Settings UI (SettingsForm.tsx) is therefore cosme
IMPACT: A 2-3h service produces thousands of segment rows. 20 churches × ~weekly services × forever = millions of rows accumulating with zero enforced retention. Storage and query cost climb continuously; the 90-day promise surfaced to churches is not kept (compliance/data-minimization gap).
FIX: Add prune-transcripts to vercel.json crons (CRON_SECRET-guarded like the others) or a scheduled GitHub Action; verify it runs and reports deleted counts.
VERDICT: True - Minor precision corrections: (1) The prune is NOT wired via any '/api/cron/prune-transcripts' route either — no such route exists (src/app/api/cron/ holds only backfill-sermons and warm-embeddings), so it could not be added to vercel.json even if desired without first creating a route; the prune exists only as a standalone tsx script. (2) Per its own header comment, scripts/prune-transcripts.ts currently CASCADE-deletes detected_references along 

--- [HIGH] (tenancy) transcript_segments and detected_references have no index on their FK columns — table scans grow with the unbounded table
FILE: src/lib/db/schema.ts:378-383 (transcript_segments), :412-422 (detected_references)
DETAIL: transcript_segments defines no index array at all — service_plan_id is unindexed (Postgres does not auto-index FKs; the schema even documents this pitfall for song_slides at :218). detected_references likewise has no index on transcript_segment_id. Every sermon-summary build JOINs transcript_segments on service_plan_id / detected_references (sermon-summary.ts:186, actions.ts:1390,1612) and the prune DELETE filters service_plan_id — all sequential scans.
IMPACT: Invisible at demo scale. As the unbounded table (finding above) reaches millions of rows across 20 churches, every post-service summary generation and every prune run degrades to a full-table scan, adding load exactly during/after the Sunday peak.
FIX: Add index on transcript_segments(service_plan_id) (or (service_plan_id, ts)) and detected_references(transcript_segment_id); ship as a migration before onboarding scale-up.
VERDICT: True - Claim is accurate. Amplification: the missing index on detected_references.transcript_segment_id also penalizes the ON DELETE CASCADE (schema.ts:414). When prune-transcripts.ts deletes transcript_segments rows, Postgres must locate dependent detected_references rows by transcript_segment_id to cascade; with no index it seq-scans detected_references per deleted parent, making the retention prune the worst-scaling path (O(deleted × table)), not jus

--- [MEDIUM] (tenancy) RLS provides no isolation — app and bridge connect as Postgres owner; all multi-tenancy is app-layer only
FILE: src/lib/db/client.ts:29-33 (DATABASE_URL owner connection); ~/presentflow SUPABASE security notes
DETAIL: Both Vercel and the Fly bridge connect via DATABASE_URL as the owner role (client.ts). Per project memory RLS was enabled on prod tables under an 'owner-role bypass' model, meaning RLS is present but the owner connection bypasses every policy. Isolation rests entirely on app-layer church_id filtering. That filtering IS consistently applied and well-tested here — two-hop ownership checks (audio/ticket:33, media/url:34, songs/[id]/slides:14, themes/[id]/apply:29) and a strong adversarial suite (test/adversarial/cross-church, audio-sessions-cross-
IMPACT: At 1-2 churches a slip is low-impact and likely caught. At 20 churches the blast radius of one missed filter is every tenant's songs/transcripts/media, with no RLS to contain it and nothing in the DB layer to detect it.
FIX: Either (a) run app queries under a non-owner role with RLS policies keyed on a per-request church_id GUC, or (b) treat the adversarial cross-church tests as a mandatory CI gate on every schema/action change and add a lint that flags church-scoped tables selected without a churchId predicate. Document the accepted risk explicitly if staying app-laye

--- [MEDIUM] (tenancy) Realtime output channel is authorized solely by a 6-char pair code — any holder of the code receives that church's live output
FILE: src/lib/realtime.ts:74-78,113-135 + schema.ts devicePairs
DETAIL: Cross-device projector/OBS sync subscribes to Supabase Realtime channel ff-out-<churchId>-<CODE> using the browser anon key with no user auth (realtime.ts comment :9-11). The pair code is the only secret. Codes are 6 chars from a 32-symbol alphabet (isValidPairCode, :234) ≈ 1e9 space, and the channel now includes churchId so blind guessing must hit a valid church+code pair. Payloads are schema-validated inbound (:141) so a subscriber can only READ, not inject. Pair codes are unique and expiring (devicePairs.expiresAt).
IMPACT: Low individual risk, but at 20 churches the number of active codes and public projector URLs multiplies. A leaked/shared pair-code URL (they get pasted into stream configs and group chats) lets an outsider watch a church's live lyrics/scripture output for the code's lifetime. No rate-limit on channel subscribe attempts is evident.
FIX: Keep churchId in the channel name (done); add short expiry + easy rotation on pair codes, and consider a signed subscribe token rather than the bare code for stream/OBS surfaces. Confirm anon-key Realtime cannot enumerate channels.

--- [HIGH] (security) All security rate limiters are per-instance in-memory Maps — brute-force/flood/spend protections collapse under Vercel serverless fan-out at scale
FILE: src/lib/rate-limit.ts:20-49 (MemoryLimiter); consumed by src/lib/auth.ts:17-20 (login), src/lib/auth-actions.ts:16-25 (signup/reset/resend), src/app/api/audio/ticket/route.ts:15 (Deepgram spend gate), src/app/api/media/presign/route.ts:61, src/lib/device-pair-actions.ts:28
DETAIL: Every rate limiter in the perimeter is backed by a single process-local `new Map()` (defaultBackend = new MemoryLimiter()). The file header itself states 'per-lambda-instance… not durable across cold starts or Fluid Compute instances… Fine for the pilot demo.' On Vercel, state-changing routes run as serverless/Fluid functions with N concurrent instances, each holding its own independent counter, and counters evaporate on every cold start. So the intended limits — login 5/15min (auth.ts), password-reset 3/hr, signup 5/hr + beta-code guessing thr
IMPACT: At 5 churches Sunday-morning traffic already forces several warm Vercel instances; at 10-20 simultaneous 2-3h services the platform auto-scales to many instances, so the login/reset/signup brute-force ceilings rise proportionally and cold starts wipe partial counts — credential-stuffing and password-reset inbox-bombing become practical, and the aud
FIX: Move defaultBackend to a shared store before onboarding beyond the pilot: Upstash/Redis (Vercel-native) via the existing RateLimiter interface (setRateLimitBackend already exists as the seam). Keep the in-memory impl only for local dev.
VERDICT: True - Claim is accurate with one minor wording fix: the beta-code/apply throttle is the "apply" limiter at 5 per 10 minutes (src/app/actions/apply.ts:15), not "signup 5/hr" — the original conflates the signup limiter (signup 5/hr, auth-actions.ts:16) with the separate apply limiter. Substance unchanged. Highest-cost exposure is the audio-ticket 30/min Deepgram spend gate, since fan-out lets an attacker open far more than 30 billed streams/minute.

--- [HIGH] (security) Live output (projector) Supabase Realtime channels have no publish-side authorization — anyone with the public anon key + church UUID + pair code can hijack a church's projector
FILE: src/lib/realtime.ts:31-52 (anon-key createClient), :113-208 (openOutputChannel — broadcast, no `private`/authorization); src/app/live/page.tsx:399-405, :706-709 (pair code rendered on-screen as 'CONNECTED VIA CODE XXXX')
DETAIL: The cross-device output channel is a Supabase Realtime broadcast channel named `ff-out-<church>-<code>` (chanName), opened with the public NEXT_PUBLIC_SUPABASE_ANON_KEY (inlined in the client bundle) and plain `broadcast` config — no `private: true`, no Realtime Authorization/RLS policy. Broadcast is symmetric: openOutputChannel exposes both publish() and subscribe(), and the transport does not restrict who may publish. The output surface only validates the *shape* of incoming payloads (isValidOutputStateExternal) — it cannot tell an operator's
IMPACT: With 5-20 churches livestreaming simultaneously each Sunday, every active pair code is on public display for hours; the anon key is identical across all tenants, so one script can enumerate/join any church's live channel and spoof or blank its projector during worship. This is a direct Sunday-morning reliability + integrity threat, not just data re
FIX: Switch the output channels to Supabase Realtime *private* channels with an Authorization policy (RLS on realtime.messages) that ties publish rights to the operator's authenticated church, keeping subscribers read-only; at minimum stop rendering the live pair code on the projector surface and drop the church-less `ff-out-<code>` legacy fallback.
VERDICT: True - Precision on the legacy-fallback vector: page.tsx:404-405 passes the `church` URL param into openOutputChannel, so operators publish to the church-scoped channel `ff-out-<church>-<code>`; the legacy `ff-out-<code>` channel (used only when churchId is empty, realtime.ts:77) reaches only projectors that also joined without a church param, so it is a narrower path than the claim implies. The realistic attack is the primary church-scoped channel, ful

--- [MEDIUM] (security) Audio-bridge ticket replay guard and Deepgram back-pressure are in-memory on the Fly bridge — break the moment the bridge scales past one machine for concurrent services
FILE: scripts/audio-server.ts:345-371 (usedTicketSigs Map replay guard, verifyTicket)
DETAIL: verifyTicket enforces a good HMAC (timingSafeEqual, planId|churchId|userId|exp binding, format + expiry checks) but the anti-replay defense is a process-local `usedTicketSigs` Map keyed by sig, cleaned opportunistically. This is correct only while the Fly app runs exactly one machine (per project memory). The HMAC ticket itself is valid for a 5-minute window and is passed as a URL query param (api/audio/ticket route.ts:76), so within that window a captured ticket can be replayed against any bridge instance that hasn't seen the sig.
IMPACT: 5-20 churches each streaming a 2-3h service concurrently is exactly the load that forces the single Fly machine to scale horizontally; the instant a second machine exists, replay protection is per-machine — a leaked/captured ticket can be replayed on a different instance within its 5-min TTL, and each instance independently opens Deepgram sessions 
FIX: Back the replay set and per-user session accounting with shared state (Redis) before scaling the bridge beyond one machine, or shorten ticket TTL drastically and bind a nonce; document the 1-machine constraint as a hard scaling gate.

--- [LOW] (security) Internal bearer-secret and cron-secret comparisons are non-constant-time; internal-semantic-search auth uses plain `!==`
FILE: src/app/api/internal/semantic-search/route.ts:41 (auth.slice(7) !== INTERNAL_SECRET); src/app/api/cron/backfill-sermons/route.ts:34 (authorization !== `Bearer ${secret}`)
DETAIL: Both compare the presented secret with JS `!==`, which short-circuits on first differing byte (timing side-channel), unlike the constant-time compares used correctly elsewhere (auth-actions signup beta code uses timingSafeEqual; audio verifyTicket uses timingSafeEqual). The secrets are high-entropy env vars so practical exploitation over network jitter is unlikely, but it is an inconsistency with the codebase's own standard.
IMPACT: Low direct scale impact; noted for consistency because these two endpoints (semantic-search, cron) are the shared-secret seams the Fly bridge and Vercel Cron hit repeatedly across all churches, so they are the highest-volume secret-comparison paths.
FIX: Compare with crypto.timingSafeEqual over fixed-length buffers, matching the pattern already used in auth-actions.ts and audio-server.ts.

--- [CRITICAL] (audio-ai) Single Fly machine + single region (LHR) + single Node process = total SPOF for every church at once
FILE: fly.toml:9-39
DETAIL: The bridge runs as ONE long-lived Node process on ONE shared-CPU/512MB VM in ONE region (primary_region="lhr", min_machines_running=1, auto_stop_machines=off, single [[vm]] cpus=1 memory_mb=512). Every operator WebSocket, every per-connection Deepgram socket, the 480KB canonical ring buffer per connection (CANONICAL_BUFFER_MAX_BYTES = 16000*2*15, audio-server.ts:697), all in-memory maps (openByUser, usedTicketSigs, rateLimitBuckets), and the single pg Pool live in that one process. There is no horizontal redundancy and no failover.
IMPACT: At 5 churches the 512MB/1-shared-CPU box is already carrying 5-10 Deepgram streams + 5-10 ring buffers + audio transcoding; at 20 churches (20-40 always-on streams for 2-3h) it will contend for CPU and approach the 512MB ceiling. A single OOM, crash, or `./scripts/deploy.sh audio` restart drops AI transcription for ALL churches simultaneously mid-s
FIX: Run >=2 machines across regions behind Fly's proxy, raise VM size, and move the in-memory guarantees (caps/replay/rate-limit) to shared storage (Redis) so multi-machine is correct. At minimum bump memory and document the SPOF as an accepted single-pilot risk before onboarding church #2.
VERDICT: True - Substantively accurate; minor line-number drift only. In-memory maps are at audio-server.ts:347 (usedTicketSigs), :417 (openByUser), :449 (rateLimitBuckets); the canonical ring buffer constant is at :696-697 (CANONICAL_BUFFER_SECONDS=15, so 16000*2*15=480KB) — as claimed. The "single pg Pool" is not instantiated directly in audio-server.ts but is the shared pool from src/lib/db/client via getDb() (line 21), so the substance holds. Additionally wo

--- [CRITICAL] (audio-ai) Unhandled promise rejection in the shared Deepgram message handler can crash the whole multi-tenant process
FILE: scripts/audio-server.ts:837-1283
DETAIL: dgOnMessage is `async` and performs multiple AWAITED DB writes on the hot path: `await db.insert(transcriptSegments)` (962), `await db.insert(detectedReferences).returning()` (1083), plus song/command inserts (1247,1270). It is attached via `dg.on("message", dgOnMessage)` (1284) with NO surrounding try/catch around the awaited inserts and NO process-level `process.on('unhandledRejection')`/`uncaughtException` handler anywhere in the file. If any insert rejects (pool connection timeout, transient Supabase blip, deadlock), the rejection is unhand
IMPACT: At 5-20 churches, awaited inserts contend for a 6-connection pool (see other finding) and WILL hit the 8s connectionTimeoutMillis under load; each timeout is a rejection thrown from inside the async listener. In modern Node an unhandledRejection can terminate the process -> every church's AI drops at the same instant, then all reconnect into the sa
FIX: Wrap the awaited DB work in try/catch (persistence is explicitly non-critical per the code's own comments), and add process-level unhandledRejection/uncaughtException handlers that log and keep serving. Fail one segment, never the process.
VERDICT: True - Claim is accurate; two refinements. (1) The unguarded awaited calls include not just the four inserts cited but also getSongLibrary(churchId) (1242) and getPrefs(churchId) (1263) — equally capable of rejecting on a Supabase/pool blip. Only the semantic-fallback (1013-1056) and phrase-search (1202-1236) blocks have local try/catch. (2) Impact nuance: because fly.toml sets auto_start_machines=true, the crashed machine auto-restarts, so it is a mid-

--- [HIGH] (audio-ai) pg Pool max=6 is shared across ALL tenants on the bridge and is sized for Vercel, not the multi-church audio server
FILE: src/lib/db/client.ts:27-35
DETAIL: getDb() creates a single process-wide Pool with max:6, and the comment shows it was tuned for 'one Fluid instance = mostly one request at a time' on Vercel. The Fly bridge imports the same getDb() (audio-server.ts:175) but is a single process handling every church's finalized-segment inserts. Each finalized segment awaits 1 transcript insert + N detected-reference inserts + song/command inserts, all serialized behind 6 connections; connectionTimeoutMillis is 8s.
IMPACT: During a busy sermon one church already fires several concurrent detections. With 5-20 churches finalizing utterances simultaneously the 6 slots saturate; the 7th+ insert queues then throws after 8s. That both stalls detection persistence and feeds the unhandled-rejection crash path above. It also silently blocks the awaited detectedReferences inse
FIX: Give the bridge its own larger pool sized for concurrent tenants (and confirm DATABASE_URL uses the Supabase transaction pooler :6543, not a direct connection that would blow Supabase's server-side connection cap at 20 churches).
VERDICT: True - Real but severity/characterization overstated (MEDIUM, not HIGH). The shared inserts are single-row indexed writes (~2-5ms); 6 connections run in parallel (not serially) and clear ~1000+ such inserts/sec, vastly exceeding the few-per-second aggregate demand of even 20 churches, so 'serialized behind 6 connections' is not a real throughput wall. The heavy reads (song library :340, prefs :316, plan :568) are per-session-open, not per-segment. Criti

--- [HIGH] (audio-ai) No global Deepgram concurrent-stream accounting vs account tier; overflow causes a reconnect storm
FILE: scripts/audio-server.ts:212-298,595-601
DETAIL: Every operator connection opens its own dedicated Deepgram nova-3 streaming socket (openDeepgram), held open for the entire 2-3h service via KeepAlive frames (820-829). There is no counter of total concurrent Deepgram streams across churches and no queueing against the Deepgram account's concurrency limit. On openDeepgram failure the client is closed with 1013 (683), which is a RETRYABLE code, so useAudioStream immediately schedules a reconnect (scheduleReconnect) that opens yet another stream.
IMPACT: 20 churches x 1-2 operators = 20-40 always-on Deepgram streams. Deepgram pay-as-you-go/lower tiers cap concurrent streams; once the cap is hit, every new or reconnecting church gets rejected -> 1013 -> fast bounded backoff reconnect (500ms..5s) -> more connect attempts hammering an already-capped account. The cohort can collectively wedge itself wi
FIX: Track concurrent DG streams process-/fleet-wide, admit against the known account limit, and return a NON-retryable close (or a 'capacity' UI state) when over cap so clients don't storm. Confirm the Deepgram tier's concurrency ceiling covers 40+ streams before onboarding.
VERDICT: True - Accurate except the reconnect is NOT an unbounded immediate storm: scheduleReconnect (useAudioStream.ts:1317-1385) uses exponential backoff (500ms/1s/2s/4s/5s cap + jitter) and gives up after 8 attempts, then sets intentionalStop, flips listening=false, and surfaces a sticky "AI couldn't connect" error. So per-client behavior is bounded retry-then-surrender, and the practical failure mode at scale is many operators losing AI detection simultaneou

--- [HIGH] (audio-ai) Single shared GROQ_API_KEY for canonical Whisper across all churches; per-connection 429 cooldown doesn't protect the account limit
FILE: scripts/audio-server.ts:700-717,1129-1140
DETAIL: canonicalKey = process.env.GROQ_API_KEY (one key for the whole bridge). Every low-confidence (<85) Bible detection across every church fires a Groq Whisper-large-v3 transcription of a ~480KB WAV. The rate-limit defenses (CANONICAL_MAX_INFLIGHT=2, CANONICAL_MIN_GAP_MS=750, 30s 429 cooldown) are all PER-CONNECTION; there is no account-wide budget. Groq's audio-transcription tier limits (RPM / audio-seconds-per-minute) are shared by the single key.
IMPACT: At 5-20 churches the aggregate canonical-pass rate easily exceeds Groq's shared audio limits during simultaneous sermons; the account-wide 429s mean one busy church's two-pass corrections starve every other church's. It fails open (correction just skipped), so it's a degradation not an outage - but the 'AI self-correcting' feature effectively dies 
FIX: Add an account-wide token-bucket for canonical passes (or a dedicated key/tier), and measure Groq audio limits against 20-church peak before relying on canonical correction in production.
VERDICT: True - Accurate with two precisions: (1) The degradation hits the canonical Whisper SECOND-PASS verification path only (a fail-open confidence-booster), NOT the primary Deepgram live-caption path — so services keep captioning; AI verse-detection accuracy quietly drops during contention rather than the service going dark. (2) There is a global per-IP connection limiter (rateLimitOk, line 506) but it governs connection rate, not Groq account audio-transcr

--- [HIGH] (audio-ai) Semantic-search Vercel hop sits on the detection critical path; mid-service dependency with cold-start/timeout exposure
FILE: scripts/audio-server.ts:1012-1036,1200-1227; src/app/api/internal/semantic-search/route.ts:26-27
DETAIL: For low-confidence refs (needsSemanticFallback) and for every non-reference segment >=30 chars (phrase cross-ref, 4s per-connection cooldown), the bridge AWAITS an HTTP POST to https://faithflow-ai.vercel.app/api/internal/semantic-search with a 4s AbortController timeout (semanticSearchHttp, 35-67). That Vercel route runs nodejs runtime loading @xenova/transformers (~90MB embedding model) to embed the query, maxDuration 15s, with an in-memory per-IP limiter of 300/min keyed on x-forwarded-for.
IMPACT: 20 churches generate a steady stream of these calls, all from the SAME Fly egress IP - so the 300/min per-IP limiter (route.ts:30) is a SHARED bucket that the whole cohort can exhaust, 429'ing semantic override for everyone. Cold starts / concurrency on the Vercel function push latency past the 4s abort, so the Revelation->Romans book-guard and phr
FIX: Make the limiter key per-church (pass churchId) not per-IP, warm/scale the embedding function or move embeddings in-process, and keep the call strictly off the awaited path (already fails-open, but the shared IP limiter and cold starts need fixing before scale).
VERDICT: True - Real but the severity framing needs two corrections. (1) It is FAIL-SOFT, not a hard critical-path failure: on any non-200, network error, or the 4s abort, semanticSearchHttp swallows the error and returns [] (lines 49-64), and the caller proceeds with the original parser guess (comments at ~1038-1052 and the phrase-block catch). High-confidence references never invoke it at all, and if INTERNAL_API_SECRET is unset on the Fly app it returns [] wi

--- [MEDIUM] (audio-ai) In-memory per-user cap, replay guard, and rate-limit silently break if Fly starts a second machine
FILE: scripts/audio-server.ts:347-457,595-601; fly.toml:23-26
DETAIL: usedTicketSigs (replay guard), openByUser (PER_USER_CAP LRU), and rateLimitBuckets (per-IP rate limit) are plain in-process Maps. fly.toml sets auto_start_machines=true with min_machines_running=1. The security guarantees these maps enforce (single-use tickets, concurrent-session cap, per-IP throttle) are only correct on a single machine.
IMPACT: The moment scaling to many churches motivates a second machine (or Fly auto-starts one under load), ticket replay protection and the per-user cap are evaluated independently per machine - a replayed ticket routed to the other machine passes, and a user can exceed the cap by landing on different machines. Also, since all churches share the Fly egres
FIX: Either pin to exactly one machine and document it, or move replay/cap/rate-limit state to shared storage (Redis) before any horizontal scale.

--- [MEDIUM] (audio-ai) transcript_segments/detected_references grow unbounded with no retention and no index on their FK columns
FILE: src/lib/db/schema.ts:378-422
DETAIL: transcript_segments is defined with no index array (only the PK), so there is no index on service_plan_id; detected_references likewise has no index on transcript_segment_id. Every finalized utterance inserts a transcript_segments row (audio-server.ts:962) and there is no TTL/retention job (only backfill-sermons and warm-embeddings crons exist). sermon RAG/backfill and any per-plan read scan by service_plan_id.
IMPACT: A 3h service produces on the order of hundreds-to-thousands of segment rows per church; 20 churches every Sunday is tens of thousands of new rows weekly, growing forever. Queries that filter by service_plan_id (backfill drain, transcript reads) degrade to sequential scans as the table grows, and storage/index bloat compounds. Not a Sunday-outage by
FIX: Add indexes on transcript_segments(service_plan_id) and detected_references(transcript_segment_id), and introduce a retention/rollup policy (archive or delete raw segments after sermon chunks are ingested).

--- [CRITICAL] (infra) Single Fly.io audio-bridge machine (1 shared vCPU / 512MB, one region) is a hard single point of failure for AI transcription across ALL churches
FILE: fly.toml (min_machines_running=1, primary_region='lhr', [[vm]] cpus=1, memory_mb=512, auto_stop_machines='off'); scripts/audio-server.ts
DETAIL: The entire real-time transcription/Bible-detection pipeline for every tenant runs through ONE Fly process (`faithflow-audio`) with a single 512MB / 1-shared-cpu VM and min_machines_running=1. There is no second machine and no second region. Each connected service opens its own Deepgram WebSocket plus makes Groq calls and Drizzle/pg queries inside this one process. tcp_checks will restart a dead machine but there is no redundancy during the restart window and no horizontal scaling.
IMPACT: 5 churches: 5+ concurrent Deepgram streams + Groq + DB all in 512MB — memory pressure/OOM risk. 10-20 churches: 10-20 simultaneous 2-3h streams on one shared vCPU/512MB will contend for CPU and heap; a single OOM/crash at 9am Sunday takes AI transcription DOWN for every church at once, and the 30s grace + restart is a global outage, not one church'
FIX: Run 2+ machines behind the same Fly app for redundancy, raise memory (512MB is far too small for N concurrent ASR sessions), and load-test concurrent-stream memory. Longer term, shard churches across machines so one crash isn't global.
VERDICT: True - Claim is accurate. Precision additions: (1) The outage window on a crash/OOM is ~1-3 min (tcp_checks 15s interval + 30s grace + Node/Docker boot), during which every church loses transcription simultaneously. (2) 512MB/1-shared-vCPU is genuinely tight for 5-20 concurrent Deepgram sockets plus per-connection canonical audio ring buffers (CANONICAL_BUFFER_MAX_BYTES=16000*2*CANONICAL_BUFFER_SECONDS, L697) and Groq in-flight buffers (CANONICAL_MAX_IN

--- [CRITICAL] (infra) No uptime monitoring or paging — nobody is alerted when the Fly bridge or DB dies at 9am Sunday
FILE: src/app/api/health/route.ts (returns {ok:true} only); src/app/api/health/{db,ai,deepgram,storage}; grep for uptime/pingdom/betterstack/pagerduty/alert = none in repo
DETAIL: Health endpoints exist (/api/health/db, /ai, /deepgram, /storage) but nothing polls them. There is no uptime monitor, no PagerDuty/BetterStack/Pingdom, no alerting integration anywhere in the codebase. Fly tcp_checks will restart a crashed machine but emit no page. Sentry is wired but only captures app exceptions, not 'the bridge is down'.
IMPACT: At any church count, if the bridge OOMs or Deepgram/Supabase degrades mid-service, the first signal is 5-20 operators reporting dead AI simultaneously during the sermon — no proactive alert, mean-time-to-detect = a phone call from an angry church. Blast radius is silent and global.
FIX: Add an external uptime monitor hitting /api/health/* and the Fly host every 30-60s with on-call paging, especially a Sunday-morning escalation.
VERDICT: True - Precise as stated, and slightly worse: the detailed health sub-endpoints are auth-gated + rate-limited (per the header comment in src/app/api/health/ai/route.ts), so they cannot even be used as an unauthenticated external uptime probe — only the top-level /api/health is publicly reachable and it checks nothing. Fly tcp_checks restart a crashed machine silently. Fix = add an external monitor (BetterStack/Pingdom/UptimeRobot) hitting a public depen

--- [CRITICAL] (infra) No offline boot / no staging: Vercel, DNS, or Supabase outage bricks every church's app boot; push-to-main can redeploy live during a Sunday service
FILE: electron/main.ts:20 (DEFAULT_HOSTED_URL='https://presentflow.org' thin-client loadURL); docs/OFFLINE_ARCHITECTURE_PLAN.md (Stage A offline-boot NOT shipped, 'sequenced after decoupling wave'); docs/STAGING_SETUP.md (file absent); vercel.json (no staging, main→prod)
DETAIL: The Electron shell is a thin client that loadURLs the hosted Vercel app at presentflow.org. The offline plan (dated 2026-09-08) explicitly states Stage A offline-boot is NOT built yet — 'no internet ⇒ no app boot.' There is no staging environment (STAGING_SETUP.md does not exist; vercel.json regions=['dub1'], main auto-deploys to prod). So a Vercel incident, DNS/alias problem, or Supabase-region (eu-west-1) outage means no church can even load the app, and any git push to main redeploys the live app for all churches with no gate.
IMPACT: One shared-fate cloud dependency down = 100% of churches unable to boot mid-service. A well-meaning Sunday hotfix push instantly ships to all 5-20 churches with no staging validation and no deploy-freeze window — a single bad deploy is a simultaneous multi-church outage.
FIX: Ship offline-boot Stage A before onboarding the cohort; stand up staging + a Sunday deploy freeze; verify Supabase/Vercel failure behavior.
VERDICT: True - Two precision notes: (1) 'dub1' in vercel.json is Vercel's Dublin region for serverless functions; the Supabase DB is separately in eu-west-1 (both EU-Ireland but different providers/regions). (2) An operator-set PF_APP_URL/NEXT_PUBLIC_APP_URL env override exists (main.ts:77-108) to point the shell elsewhere for dev/staging, but that is a URL override, not a staging environment, and does not mitigate the risk. The already-shipped offline incremen

--- [HIGH] (infra) Shared 5k/month API.Bible key with only ephemeral in-process cache — quota exhaustion kills licensed translations for all churches at once
FILE: src/lib/server/bible.ts:18 (single process.env.API_BIBLE_KEY); src/lib/server/api-bible.ts:22 (in-process Map cache, per-instance, non-persistent, 24h)
DETAIL: All churches share one API.Bible key (platform-wide, ~5k requests/month per the memory notes). The only cache is an in-process Map on each serverless instance — it does not persist across Vercel instances or cold starts, so real cache-hit rate under many short-lived instances is low. There is no per-church quota accounting or backpressure.
IMPACT: 10-20 churches doing NIV/NKJV/NLT verse lookups every Sunday, each on freshly-spun Vercel instances with empty caches, can burn the shared 5k/mo quota quickly; once exceeded, licensed-translation lookups return errors for EVERY church, not just the heavy user, mid-service.
FIX: Move to a shared/persistent cache (Redis/Edge Config or DB-backed) keyed by passage, add per-church usage metering, and raise/segment the API.Bible plan before onboarding.
VERDICT: True - Claim is accurate; two precisions. (1) Blast radius is every church relying on the PLATFORM key for licensed NIV/NKJV/NLT, not literally all churches: public-domain translations (KJV/WEB/etc.) are served from local Postgres and never hit the quota (getFullPublicDomainTranslation, lookupReference non-licensed path), and a church that configured its OWN key bypasses the shared quota via getLicensedRow precedence (bible.ts:237-243). (2) The claim un

--- [MEDIUM] (infra) electron-updater set to autoDownload + autoInstallOnAppQuit from GitHub Releases with no staged rollout or kill switch
FILE: electron/main.ts:786-811 (autoUpdater.autoDownload=true; autoInstallOnAppQuit=true; hourly checkForUpdates; GitHub Releases feed)
DETAIL: Once builds are signed (the code guards on signed/packaged builds; DMGs are currently unsigned per memory, so this is dormant today but arms the moment signing lands), every church's shell polls GitHub Releases hourly, auto-downloads any new release, and auto-installs on next quit. There is no percentage/staged rollout, no server-side kill switch, and no version pin — one bad release propagates to all installs.
IMPACT: After code-signing is enabled, a single broken release published to GitHub auto-installs on all 5-20 churches at their next app quit — a bad update becomes a simultaneous fleet-wide brick with no ability to halt the rollout mid-flight.
FIX: Add staged rollout (release channels / % rollout), a remote kill switch / minimum-version gate, and a manual-approval step before a release is discoverable by the fleet.

--- [LOW] (infra) CSP shipped Report-Only, so security headers are advisory not enforcing at cohort launch
FILE: next.config.ts (Content-Security-Policy-Report-Only, comment: flip to enforce 'when the console goes quiet across a Sunday service')
DETAIL: The CSP is intentionally Report-Only pending telemetry. This is a launch-hardening gap (Frontier 01/04) rather than a scaling SPOF, but it means the primary XSS mitigation is not actually enforced while onboarding real church tenants.
IMPACT: Not a capacity issue, but at 5-20 tenants an XSS in any shared component is not blocked by CSP; flip to enforce before broad onboarding.
FIX: Collect report-only violations, resolve them, and switch to enforcing Content-Security-Policy.
==================== refuted 2

--- [HIGH] (infra) Audio bridge shares a single 6-connection pg pool across ALL churches in one process
FILE: src/lib/db/client.ts (getDb, Pool max:6); scripts/audio-server.ts:175 (const db = getDb())
DETAIL: getDb() creates a pg Pool with max:6. The audio bridge is one long-lived process that imports this single pool and serves every church's prefs/song-library/plan/verse lookups. The pool was sized (per the file's own comment) for 'one Fluid instance = mostly one request at a time' on Vercel — that reasoning does not apply to a shared multi-tenant daemon.
IMPACT: 10-20 churches each firing multi-verse detection bursts (comment notes several references land in the same second) contend for 6 connections in the ONE bridge process; the 7th+ query queues on pg's internal queue (no timeout) and surfaces as 'Verse lookup timed out' for whichever churches lose the race — cross-tenant interference where one busy chu
FIX: Give the bridge its own larger, explicitly-sized pool (or per-church fairness), and confirm it targets the Supabase transaction pooler; monitor pool saturation.
VERDICT: False - Downgrade to LOW/informational hardening note. Real residual: the pool has no per-church fairness and, under a pathological Supabase pooler slowdown, a burst of write-inserts across many churches could queue and past 8s surface as failed detection/segment persistence (missed logging, not missed live projection since detections flow over WS). Fix is trivial — raise max or monitor pool-acquire wait — and belongs on a pre-scale checklist, not as a H

--- [HIGH] (infra) No proof prod uses Supabase transaction pooler (6543); deploy path only rejects localhost, never enforces pooler mode
FILE: scripts/deploy.sh:48-55 (DATABASE_URL check only blocks *localhost*); src/lib/db/client.ts (node-postgres Pool per Vercel instance)
DETAIL: DB connections are made with node-postgres Pool using DATABASE_URL. .env.local uses postgres@localhost:5432. deploy.sh comments say 'Supply the hosted pooler URL' but only rejects localhost — it does NOT verify port 6543 / transaction mode. No 6543/pgbouncer/pooler reference exists anywhere in deploy config. On Vercel Fluid, each warm instance holds up to 6 connections; multiplied across many instances and the separate Fly bridge, a direct (5432) URL would exhaust Supabase's direct connection ceiling.
IMPACT: If prod DATABASE_URL is the direct 5432 endpoint, 10-20 churches × multiple Vercel instances × 6 + the bridge's 6 will blow past Supabase's direct connection limit on Sunday morning, causing 'too many connections' errors that hit all tenants simultaneously — the classic serverless-connection-storm outage.
FIX: Enforce the Supabase transaction pooler (6543) in prod, assert the port in deploy.sh, and set pool max in line with pooler session budget.
VERDICT: False - Only a weak, lower-severity residual holds: nothing in code enforces transaction mode (6543) over session mode (5432) — the prod-detection regex matches pooler.supabase.com for both — and drizzle/node-postgres on a transaction pooler needs prepared statements disabled, which isn't visibly configured. Worth a note, but not HIGH and unverifiable without the prod env var.
