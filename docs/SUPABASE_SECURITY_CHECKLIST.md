# Supabase Security Checklist

Practical checklist for the Supabase dashboard security emails. Walk through it in
the dashboard; nothing here requires code changes on our side.

## Why RLS is not enabled in this repo

Supabase's advisor keeps flagging tables as "RLS disabled." That's intentional for
now, and here's the honest reason:

- The app talks to Postgres via a raw `pg` Pool over `DATABASE_URL` (see
  `src/lib/db/client.ts`). There's no JWT / `auth.uid()` / service_role context
  attached to each query, so RLS policies keyed off `auth.uid()` or Supabase JWTs
  would have nothing to check against.
- Naively toggling RLS "on" with no policies would deny every query and take the
  app down. Toggling it on with permissive policies would be security theater.
- Instead, tenant isolation is enforced at the app layer: `requireUser()` /
  `requireCap()` (see `src/lib/session.ts`) resolves the caller and every DB
  write and semantic query is scoped by `churchId`. See `src/lib/actions.ts` and
  `src/lib/server/*`.
- This is adversarially tested in `test/adversarial/` (cross-church leakage +
  prod invariants) — runs before every ship per `docs/AGENT_WORKFLOW.md`.
- The only unscoped table is the Bible library, which is intentional and
  documented at `src/lib/server/bible.ts:12-17`.

The "adopt RLS properly" path is in "Future work" below.

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

## Future work (not urgent)

- Migrate admin/write surfaces to the Supabase JS client with the `service_role`
  key server-side, keeping RLS OFF for those paths but ENABLING RLS on any
  future tables read directly by browsers via `anon`. This is the path that
  lets us turn RLS on without rewriting every query.
- When we add browser-side reads (e.g. a public sermon archive), those tables
  should be RLS-on from day one with explicit `select` policies.
- Add `pgcrypto`-backed audit trail on `settings` and `users` role changes.

## Acknowledging vs fixing

Supabase advisors don't distinguish "acknowledged with reason" from "unfixed."
For anything above marked "intentional," the answer to a re-raised email is the
link to this doc, not a code change.
