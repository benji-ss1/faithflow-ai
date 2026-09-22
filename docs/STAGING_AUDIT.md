# Staging environment — audit and decision (2026-09-22)

Full ten-angle audit. The short version: **you do not need a staging
environment this month.** You need three small things, about a day and a half,
costing nothing per month.

---

## 🔴 CHECK THIS FIRST — one minute, and it may collapse the whole project

The assumption that "previews use the production database" is **NOT
established**. `vercel env ls` shows `DATABASE_URL` and `AUTH_SECRET` scoped
SEPARATELY to Preview and Production — two distinct entries, unlike the
genuinely shared ones (`S3_BUCKET`, `AWS_*`, `GROQ_API_KEY`) which Vercel prints
on a single row spanning both.

Someone may already have given Preview its own database 63 days ago.

Run this and compare ONLY the host. Do not paste the passwords anywhere:

```bash
vercel env pull /tmp/pf-prod.env --environment=production --yes
vercel env pull /tmp/pf-prev.env --environment=preview --yes
grep -o 'DATABASE_URL=.*@[^:/]*' /tmp/pf-prod.env | sed 's/.*@//'
grep -o 'DATABASE_URL=.*@[^:/]*' /tmp/pf-prev.env | sed 's/.*@//'
rm /tmp/pf-prod.env /tmp/pf-prev.env
```

- **Different hosts** → a staging DB already exists. This drops from ~2 weeks
  of work to about a day.
- **Same host** → previews write to the live database, and everything in the
  blast-radius section below is live today.

---

## The worst risk, and it is not the database

**S3 is genuinely shared** — `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and
`S3_BUCKET` all span Production and Preview. `src/lib/s3.ts:106` is an
unconditional hard delete with no environment guard, reached from
`src/lib/actions.ts:1646` (media asset + thumbnail) and `:1704` (every image of
a PPTX import).

**So a tester deleting a media asset on a preview deletes the real file.**
Uploaded sermon graphics and background videos are the one asset class with no
upstream copy — the real Sunday plan that references it then renders a hole.

**The fix is ~20 minutes and no code:** strip `s3:DeleteObject` from the
preview/staging IAM user. Media still resolves (read + write remain), the
delete throws instead of destroying, and the callers already swallow that
failure — they comment it as "orphan — recoverable". **Do this even if you do
nothing else here.**

Also UNVERIFIED and worth ten minutes: **is S3 bucket versioning on?** Without
it, media deletion is unrecoverable in production too — a resilience gap the
staging question merely surfaced.

---

## What else a preview can reach today

| Surface | Status |
|---|---|
| Media delete | 🔴 Shared bucket, unconditional hard delete |
| Database writes/deletes | 🔴 24 delete sites, all church-scoped — but church scoping is TENANT isolation, not ENVIRONMENT isolation. It cannot protect a real church from a tester logged into that real church. |
| Sermon RAG ingest | 🟡 Writes real `sermon_chunks` rows |
| Fly audio bridge | 🟡 Shared. Preview audio consumes live Deepgram quota, and the callback secret is production-only so **detection is silently a DIFFERENT system on preview** — never benchmark detection there |
| Cron | 🟡 Shared secret, but Vercel only schedules crons on production |
| Stripe | 🟢 Key absent in BOTH environments; billing inert |
| Email | 🟢 `RESEND_API_KEY` is production-only — a preview **cannot** email a real pastor |
| Supabase Realtime | 🟢 Keys are production-only, so cross-device sync no-ops on preview |

The last two are accidental safety properties. **A naive staging setup — copying
the production env into a new project — destroys both.**

---

## Recommended: do the cheap thing now

### This week (~1.5 days, £0/month)

1. **Answer the check at the top.** 60 seconds.
2. **Strip `s3:DeleteObject`** from the preview IAM user. ~20 min.
3. **Confirm S3 versioning is on.** ~10 min.
4. **Build the staging/preview banner.** Half a day. Details below.
5. **Finish `isDemo`.** The schema already has it (`schema.ts:40-41`) with the
   comment *"Demo rows ... get a banner in the shell"* — and the banner was
   never built. The flag is read in exactly one place
   (`song-limits-server.ts`, for song limits) and rendered nowhere. Create a
   demo church for Victor and render the thing the schema promised.
6. **Delete the dead Redis/KV vars** — set across all three environments,
   referenced nowhere in the codebase.

**Say plainly what this does NOT cover:** migrations cannot be tested, nothing
global can be tested (a bad deploy, a Fly change), and a cross-tenant isolation
bug would let a tester out of the demo church.

### The banner — design it to fail LOUD

The dangerous direction is asymmetric: believing you are on staging when you
are on production is catastrophic; the reverse is merely annoying. So the
signal must be **absent on production and impossible to miss elsewhere** — a
broken banner should degrade toward "looks like production", never toward
"looks safe".

- Render it when `VERCEL_ENV !== "production"` — inverted, so it appears by
  default and only production's explicit value suppresses it.
- A hard-coded red (never a theme token — a theme bug must not be able to hide
  it), pinned above all chrome, pushing content down so nothing can overlap it.
- Include the data refresh date, so staleness is visible on every screen.
- **Put it on `/live`, `/stage` and `/livestream` too.** Those are what a
  congregation sees. If a staging projector output is indistinguishable from
  production, someone will eventually run a real service off staging.
- **Do not rely on the URL.** Preview URLs are long hashes nobody reads, and
  the desktop shell has no address bar at all.

### Later, when the pilot is stable (~2 days, ~$25/month)

A second Supabase + a staging Vercel project, **browser-only for Victor**, with
`PF_APP_URL` for the developer. Skip a staging desktop build: it drags in a
deep-link collision (one OS-level `presentflow://` registration, two builds
fighting over it) and an auto-update channel problem (a staging build that
auto-updates onto production mid-test produces confident, wrong results).

Non-negotiables for that environment:
- **`AUTH_SECRET` must differ.** Share it with a restored production database
  and real password hashes authenticate on staging.
- **No `RESEND_API_KEY`, no ops webhooks, no Sentry/PostHog.**
- **Scrub before anyone touches it**, as a committed script, not a runbook:
  emails to `@staging.invalid`, one known test password hash, **NULL every
  `totpSecret`** (plaintext MFA seeds), truncate `betaApplications` (contains
  IP addresses — personal data), truncate invitations, and **truncate
  `sermonChunks`/`sermonSummaries`** — verbatim preaching transcripts naming
  real congregants, illness, bereavement. Arguably special-category data. The
  honest cost: sermon search then cannot be tested on staging.

**Legal:** confirm with a data-protection advisor whether your DPA permits
copying customer data into a non-production environment, and whether Victor
needs naming as a sub-processor. Not cleared here.

---

## Two traps worth naming

**Half-built staging is worse than none.** Stale, flag-drifted or missing-media
staging produces *confident passes on a system that does not exist*. Rule 0
says doing nothing beats regressing — a staging environment that lies is a
regression in your ability to ship safely, with no code changed.

**Flag drift will invalidate staging faster than stale data.** Preview already
carries its own `NEXT_PUBLIC_LAYERS_V2`, one still scoped to a dead branch.
With this much of the product flag-gated, staging quietly becomes a
configuration that never runs on a Sunday.

## Media: why a database-only copy is worse than useless

S3 keys embed the church id (`{churchId}/media/{uuid}.ext`), and stored URLs are
presigned with a 6-hour expiry. `keyFromPresignedUrl` only re-signs when the
**host matches ours** — so pointing staging at a different bucket means every
stored URL silently fails that check and is left as a dead expired link. Not a
visible 404; a quiet nothing.
