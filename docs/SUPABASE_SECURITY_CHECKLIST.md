# Supabase Security Checklist

Practical checklist for the Supabase dashboard security emails. Walk through it in
the dashboard; nothing here requires code changes on our side.

## RLS — now enabled via `drizzle/rls_enable.sql`

**Status (2026-07-30):** RLS migration script written and ready to apply.
See `docs/rls_enable.sql` for the full SQL and detailed comments.

### Why this is safe for our architecture

The app's `DATABASE_URL` connects to Supabase via the `postgres` user (a PostgreSQL
superuser). In Postgres, **superusers bypass RLS automatically** — so enabling RLS
does not change any server-side query behaviour. Zero application code changes needed.

What DOES change:
- Any direct access with the `anon` key or `authenticated` role is now DENIED by
  default — this is the security win. Previously, a leaked anon key could read any
  table.
- The `service_role` (PostgREST) also has explicit bypass policies, so future
  Supabase JS client usage works correctly.

Supabase Realtime is NOT affected — this project uses Broadcast channels only
(not `postgres_changes` subscriptions), so no Realtime reads are blocked.

### How to apply

```bash
# Option A — Supabase dashboard (recommended for first apply)
# 1. Open https://supabase.com/dashboard → your project → SQL Editor
# 2. Paste the contents of docs/rls_enable.sql
# 3. Click Run
# 4. Check: Table Editor → any table → should show "RLS: Enabled"

# Option B — psql
psql "$DATABASE_URL" -f docs/rls_enable.sql

# Option C — Supabase CLI
supabase db push  # (if tracking as a migration)
```

The script is **idempotent** — safe to run multiple times. Existing policies
just emit "already exists" notices.

### If something goes wrong

Disable RLS on any table instantly:
```sql
ALTER TABLE <table_name> DISABLE ROW LEVEL SECURITY;
```

This is fully reversible and takes effect immediately.

### Tables intentionally excluded from RLS

| Table | Reason |
|---|---|
| `bible_verses` | Global reference data, no church_id — documented exception in `src/lib/server/bible.ts:12-17` |
| `bible_translations` | Same |

### Why the old note said "would take the app down"

The original warning was overly conservative. It was written before we confirmed
that `DATABASE_URL` connects as the `postgres` superuser, which bypasses RLS
unconditionally. The explicit bypass policies in the SQL file are belt-and-suspenders
(they cover the `service_role` path too), not required for the pooler connection.

### App-layer tenant isolation (unchanged)

RLS is now a second line of defence, not the primary one. The primary layer remains:
- `requireUser()` / `requireCap()` in `src/lib/session.ts`
- `churchId` scoping on every DB write in `src/lib/actions.ts` and `src/lib/server/*`
- Adversarial tests in `test/adversarial/` (run before every ship)

## Dashboard toggles to flip today

These address the common security emails and cost nothing to enable:

- **Auth > Providers > Email > Leaked password protection**: ON. Uses HaveIBeenPwned
  to reject known-compromised passwords at signup / reset.
- **Auth > Providers > Email > Password strength**: set minimum length ≥ 10 and
  require at least one of upper / lower / digit / symbol.
- **Auth > MFA**: enable at least one additional factor beyond TOTP if we ever
  wire MFA into the client. Even if not consumed yet, having it available means
  the "insufficient MFA methods" warning stops firing.
- **Auth > Rate limits**: leave defaults on. Confirm the "one-time token requests"
  and "sign up / sign in" caps are enabled.
- **Auth > Email templates > OTP expiry**: shorten to ≤ 3600 seconds (1 hour).
  The default of 24h is what the advisor complains about.
- **Auth > URL Configuration**: confirm allowed redirect URLs are the exact
  production + staging origins. No wildcards.
- **Database > Functions**: any custom SQL function you or a migration created
  should have `SET search_path = public, pg_catalog` (or `''` if it doesn't
  touch tables) explicitly set. This closes the "mutable search_path" advisor
  finding. If we haven't authored any custom functions, the warning may be
  triggered by extension-installed functions — those are safe to acknowledge.
- **Storage > Policies**: this repo uses S3-compatible storage. If any Supabase
  Storage buckets show up as "public with no policies," delete them — we don't
  use them.

## Client-side keys

- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are NOT set
  locally, and that's intentional. The client-side Realtime bridge in
  `src/lib/realtime.ts` degrades gracefully to a no-op when they're missing —
  same-machine sync via `BroadcastChannel` (`src/lib/broadcast.ts`) still works,
  which is the primary path per non-negotiable #8 in `CLAUDE.md`.
- If you set them in production, use the `anon` key (never `service_role`) for
  anything shipped to the browser.

## Future work

- Apply `docs/rls_enable.sql` to production — **READY, just needs running**.
- When we add browser-side reads (e.g. a public sermon archive), add a
  `SELECT` policy for the `anon` role on those specific tables.
- Add `pgcrypto`-backed audit trail on `settings` and `users` role changes.
- Wire TOTP 2FA UI — schema (`totpSecret`, `totpEnabled`) and `otplib` dep
  already present; user-facing setup flow not yet built.

## Acknowledging vs fixing

Supabase advisors don't distinguish "acknowledged with reason" from "unfixed."
For anything above marked "intentional," the answer to a re-raised email is the
link to this doc, not a code change.
