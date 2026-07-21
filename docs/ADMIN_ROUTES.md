# Admin Routes Manifest

Source of truth for the **Present Flow web/desktop boundary**. As of the
2026-07-21 web/desktop split, this is enforced **symmetrically** in
`src/middleware.ts` (`desktopPathAllowed()`), not just as documentation:
the "Electron-only" section below is now the *only* thing the web build can't
reach, in addition to being the *only* thing the desktop shell can reach.
The web app cannot do anything with the projector or push anything live —
that's exclusive to the desktop app, matching how ProPresenter splits its
authoring/admin surface from the actual live-show operation.

This file is machine-readable in spirit — future work: emit `admin-routes.json` from this list for the Electron packager.

---

## Admin (web-only) — deploy to Vercel, exclude from Electron

Church administration, billing, team, analytics, onboarding. An operator running a live service never visits these.

- `/(app)/organization` — church profile (name, city, denomination, logo, timezone)
- `/(app)/settings` — root settings (logo, blank bg, font family)
- `/(app)/settings/team` — invite team members, role assignment, remove users
- `/(app)/settings/billing` — Stripe subscription, plan tier, payment methods, invoices
- `/(app)/settings/outputs` — placeholder page pointing to desktop app download
- `/(app)/subscriptions` — subscription management
- `/(app)/products` — product/plan catalog
- `/(app)/analytics` — AI accuracy trend, top songs/scriptures, service length, detection breakdown
- `/(app)/archive` — sermon archive index (past services list)
- `/(app)/archive/[id]` — sermon archive detail + transcript export
- `/(app)/help/first-sunday` — help center
- `/(app)/tutorial` — post-onboarding tutorial revisit
- `/(app)/profile` — user profile + TOTP setup
- `/signup`, `/login`, `/verify-email`, `/forgot-password`, `/reset-password`, `/accept-invite`
- `/onboarding`, `/onboarding/download` — signup + church setup + download prompt
- `/api/stripe/webhook` — Stripe webhook receiver

## Shared (both surfaces need these)

Library management + service planning. Editable from web; consumed by desktop during live services.

- `/(app)/dashboard` — home
- `/(app)/services`, `/(app)/services/[id]` — service plan list + editor (not the live operator console)
- `/(app)/library/bible`, `/(app)/library/bible/licensed`
- `/(app)/library/songs`, `/(app)/library/songs/[id]`
- `/(app)/library/media`
- `/(app)/library/themes`
- `/(app)/library/imports`, `/(app)/library/imports/[id]`, `/(app)/library/imports/wizard`
- `/(app)/applications`
- `/(app)/settings/devices` — device pair code list (mint codes to sync desktop screens)
- Most `/api/*` routes (bible, ai, media, songs, imports, autopilot, sermon, search, themes, health)

**Known inconsistency, not yet resolved**: `/(app)/practice` and
`/(app)/setup/projector|audio|diagnostics` configure the operator machine's
own hardware/rehearsal flow and arguably belong in "Electron-only" below —
but they are *not* in `DESKTOP_ALLOWED_PAGE_PREFIXES` in `src/middleware.ts`,
so today they only actually work from the web build (backwards from what
their purpose implies). Left as-is in this pass (2026-07-21) since expanding
the desktop allowlist to include them is a separate, unreviewed change —
follow up separately.

## Electron-only — desktop-exclusive, blocked from web

The operator console + live output sinks + the operator-time APIs that
actually push content live. Enforced both ways by `desktopPathAllowed()` in
`src/middleware.ts`: this is the *only* thing desktop can reach, and as of
2026-07-21, the *only* thing a plain browser cannot reach. A browser hitting
any of these gets redirected to `/(app)/settings/outputs` (pages) or a 403
(APIs).

- `/operator` — live operator console
- `/services/[id]/operate` — live operator console for a specific plan
- `/live` — projector/screen sink
- `/stage` — stage display
- `/livestream` — livestream output
- `/api/audio/ticket` — mints the HMAC ticket for the live Deepgram WS bridge
- The rest of `DESKTOP_ALLOWED_API_EXACT`/`_PREFIXES`/`_REGEX` in `src/middleware.ts` (pptx convert, media presign, sermon match, autopilot history, songs/library, etc.) — these are all operator-time actions, not admin data management

---

## Settings sync contract

Church-level settings edited on the web portal sync to the desktop app via the shared Supabase database. The desktop app reads `churchPreferences` on launch and on user-triggered sync. Schema fields covered:

- `defaultTranslationId` — default Bible translation
- `detectionConfidenceThreshold` — AI confidence threshold
- `autoApproveEnabled` + `autoApproveThreshold` + `autoSendToLive` — Autopilot defaults
- `productionMode` — Safe Mode toggle
- `transcriptRetentionDays` — transcript retention period
- `aiListeningDefault` — AI listening on/off default
- `commandPrefix` — operator voice command prefix

There is no push notification — the desktop app polls on next launch/sync. Real-time push is a future feature.
