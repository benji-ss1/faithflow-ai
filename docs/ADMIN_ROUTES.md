# Admin Routes Manifest

Source of truth for the **Present Flow web admin portal boundary**. The Electron desktop build must **exclude** every route listed under "Admin (web-only)" below. The web build must **include** everything.

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
- `/(app)/practice`
- `/(app)/applications`
- `/(app)/setup/projector`, `/(app)/setup/audio`, `/(app)/setup/diagnostics`
- `/(app)/settings/devices` — device pair code list (mint codes to sync desktop screens)
- Most `/api/*` routes (bible, ai, media, songs, imports, autopilot, sermon, search, themes, health)

## Electron-only — desktop, exclude from web

The operator console + live output sinks. These render on the desktop app running the service.

- `/services/[id]/operate` — live operator console
- `/live` — projector/screen sink
- `/stage` — stage display
- `/livestream` — livestream output

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
