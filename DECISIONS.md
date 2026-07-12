# Decisions — bible-redesign branch

Autonomous mode. Judgment calls the agent made during the ProPresenter-style Bible panel redesign.

## Judgment calls

- **New file, not in-place rewrite of `BibleBrowser.tsx`.** The library route `/library/bible` uses `BibleBrowser` as a plan-builder (staged verses → add to service plan), which is a fundamentally different UX from the operator cockpit panel. Rewriting BibleBrowser in place would break the plan-building flow. Instead a new `src/components/library/BiblePanel.tsx` was created and the operator wrapper (`BibleBrowserMode`) now composes it. `BibleBrowser.tsx` at `/library/bible` is left untouched.
- **Bible panel launched as a modal from the LeftColumn "Bible" library button.** The active `OperatorShell` renders `CenterWorkspace` directly (not `WorkspaceTabs`), so `BibleBrowserMode` is not currently mounted in the visible cockpit. Rather than restructure the shell, the new panel opens as a right-anchored overlay when the operator clicks Bible in the LeftColumn library list. `WorkspaceTabs` still works (`BibleBrowserMode` now wraps `BiblePanel`) so both entry points stay valid.
- **Quick Access removal is per-session (client-only).** `useVerseBank` exposes `clear` but no `remove`. A `hiddenBankIds` `Set` in `OperatorConsole` masks removed items from the shell ctx. This preserves the persistent bank contract (bank contents remain the audit trail) while giving the operator a client-side "x" for stale entries. Documented in-comment.
- **Translation hint parsing lives in the panel, not the parser.** The reference parser (`src/lib/bible-parser.ts`) intentionally focuses on book/chapter/verse. Adding trailing-phrase translation hints ("in the NLT", "amplified version") there risks regressions in existing tests. Instead the panel extracts hints from `detection.matchedText` via a small regex against known translation codes (`extractTranslationHint`). This keeps the parser stable.
- **Autopilot auto-send in the panel is additive.** The OperatorConsole already has an auto-approve pipeline via `useAudioStream` detections. The panel's autopilot only auto-sends when the panel is mounted AND `autoApproveEnabled && autoSendToLive && confidence >= threshold`. It reads `detections` as a prop; it does not duplicate `updateDetectionStatus` writes (Console still owns those). If the panel is closed, existing autopilot behaviour in `OperatorConsole` is untouched.
- **Safe Mode default OFF, persisted in localStorage `presentflow.safeMode`.** Matches the task spec.
- **Reference format persisted as `presentflow.biblePanel.refFormat`, view as `presentflow.biblePanel.view`, card size as `presentflow.biblePanel.cardSize`.**
- **Global Esc / Ctrl+C posts `{type:"clear"}` on the BroadcastChannel only when the panel is mounted** and only when the event target is not an input/textarea. This is layered on top of the OperatorConsole's existing Escape handler (which sets local state + posts clear), so both agree.
- **Transitions.** The existing `/live` page (`src/app/live/page.tsx`) already consumes `OutputState.transition` and applies keyframes via `TransitionWrapper`. Verified; no wiring was needed there. The panel writes `TransitionSpec` upward via `onSetTransitionSpec` (already in `shellCtx`), so `OutputState.transition` is populated on the next state-broadcast tick. For explicit send-to-live the panel also passes the spec into `sendSlideToLive`, which sets `transitionSpec` immediately before posting.

## Skipped / stubbed

- **Semantic ("Search by meaning") search** was on the original `BibleBrowser` but is not part of the task spec — omitted from `BiblePanel`. The plan-builder page still has it.
- **"Save As..."** posts through the same `useVerseBank.addReference` path used by AI approval — so bank contents come with the ±5 preload window automatically.
- **Passage-mode pagination** currently uses 2 verses/card (verse-mode uses 1). No user setting for this beyond the toggle.
- **`/library/bible` page** deliberately unchanged (plan-builder UX vs. operator UX).

## Manual test checklist (dev server not run per instructions)

1. Open operator console; click **Bible** in the LeftColumn library list — the panel opens as a right-anchored overlay.
2. Type `John 3:16` in the reference input → press Enter → verse card renders with white text on dark background.
3. Single-click a card → card shows staged (teal ring). Confirm Preview updates in OperatorConsole (`stagedAISlide`).
4. Double-click a card (Safe Mode OFF) → `BroadcastChannel` `set` message posted; `/live` output window (open it via the projector button) shows the slide with the selected transition applied. Devtools → Application → BroadcastChannel or a listener log verifies the `set` message.
5. Toggle Safe Mode ON → double-click stages instead. Click **Send to Live** button → live updates.
6. Adjust transition style + duration → next double-click respects new spec (visible in `OutputState.transition`).
7. Click **Save As...** → verse appears in LeftColumn **Quick Access** panel.
8. Click a Quick Access item → live updates. Hover shows an **x**; click removes it.
9. Click **< Verse** / **Verse >** → prev/next verse loads and card updates.
10. Change translation dropdown → next search uses new code; existing cards persist until re-search.
11. Press **Esc** or **Ctrl+C** (with focus outside inputs) → live clears (`BroadcastChannel` `clear` message posted).
12. Simulate an AI detection (via `SimulatePhraseInput` — e.g. "as it says in John 3:16") → an AI-detected card appears inline with green **AI Detected · NN%** badge. Confidence renders. If the transcript includes a translation phrase (e.g. "John 3:16 in the NLT") and NLT is available, the card renders in NLT with a translation label.
13. Turn on **Autopilot ACTIVE + auto-send-to-live** (in the operator autopilot picker) with the panel open → the next high-confidence detection auto-sends to live directly from the panel (toast: `Autopilot → LIVE · ...`).
14. Verify `/library/bible` (the standalone plan-builder route) still works as before — untouched.

---

# Present Flow Admin Portal — Decisions Log

Autonomous-mode judgment calls for the `admin-portal` branch (Terminal 3). Every non-obvious call is captured here so a reviewer can audit the boundary and know what was deferred vs done.

Date: 2026-07-12
Branch: `admin-portal`
Working dir: `~/presentflow/presentflow-admin` (clone of `faithflow-ai`, package name still `faithflow-ai`)

---

## Scope-boundary calls

**1. No mass file moves into an `(admin)` route group.**
The brief suggested marking admin routes "e.g. under an /admin route group." A physical `(admin)` group would touch 20+ page files, plus every `<Link>` (Next route groups don't change URLs, but developer navigation still relies on the group directory). Doing that autonomously without a test suite green-light violates the repo's "no soft passes" standard in `docs/AGENT_WORKFLOW.md`.
**Decision:** capture the boundary as a manifest (`docs/ADMIN_ROUTES.md`) that the Electron packager will consume as its route exclusion list. Physical relocation deferred to a follow-up branch where each move gets its own commit + verification.

**2. No changes to `/services/[id]/operate`, `/live`, `/stage`, `/livestream`, `/(app)/library/bible/*`, or `test/*`.**
Scope boundary in the brief. Not touched.

**3. Devices & Outputs page = new sibling, not overwrite.**
`/(app)/settings/devices` already exists and is functional (mints pair codes for projector/stage/stream sync — still needed by shared library flow). Overwriting it with a placeholder would remove working functionality.
**Decision:** added `/(app)/settings/outputs` as a new placeholder page pointing to the desktop download; existing `/settings/devices` retained unchanged. Manifest classifies `outputs` as admin-only, `devices` as shared.

---

## Already-built pieces — kept as-is

Per the repo map, these already exist and function. Rebuilding autonomously without acceptance criteria risks regressions, so I inspected but did not modify them:

| Ask (from brief) | Existing implementation | Verdict |
|---|---|---|
| Church profile | `/(app)/organization` — name, city, country, timezone, denomination, congregation size, logo | Sufficient |
| Team management | `/(app)/settings/team` + `invitations` table + `/accept-invite` flow + role enum (admin/operator/pastor) | Sufficient |
| Billing (Stripe test mode) | `/(app)/settings/billing`, `src/lib/stripe.ts`, `src/lib/billing-actions.ts`, `subscriptions` table, `/api/stripe/webhook` | Scaffolding present. Plan-picker UI ("Standard vs Max") and invoice-history rendering not verified — flagged below. |
| Settings sync to desktop | `churchPreferences` table already stores translation, AI threshold, autopilot defaults, safe mode, transcript retention; desktop reads this on launch | Contract documented in `docs/ADMIN_ROUTES.md` |
| Analytics | `/(app)/analytics` — recent services, accuracy trend, top songs/scriptures, avg length, breakdown; helpers in `src/lib/server/analytics.ts` | Sufficient |
| Sermon archive | `/(app)/archive`, `/(app)/archive/[id]`, `sermonSummaries` table with `embedding vector(384)` for semantic search | Sufficient. Search UI not audited — flagged below. |
| Onboarding | `/onboarding` wizard with 4 steps (workspace → present type → invite team → done) via `OnboardingWizard.tsx` | Sufficient, redirect target changed (see below) |

---

## Actual changes on this branch

1. **`docs/ADMIN_ROUTES.md`** — created. Manifest of admin (web-only) vs shared vs electron-only routes + settings-sync contract.
2. **`src/app/(app)/settings/outputs/page.tsx`** — created. Devices & Outputs placeholder: "Manage your devices from the Present Flow desktop app" + download button + link to existing pair-code page.
3. **`src/app/onboarding/download/page.tsx`** — created. Post-onboarding "Download Present Flow for your computer" page with Mac/Windows download cards + fallback link to `/dashboard`.
4. **`src/components/onboarding/OnboardingWizard.tsx`** — one-line change. Final step now redirects to `/onboarding/download` instead of `/dashboard`.

Total LOC: ~130 new, 1 changed. Under the 100 LOC "3-review-agents required" bar for changed code; new isolated pages do not touch auth/data/church_id/AI/output surfaces, so they inherit that classification. No church_id writes, no vector queries introduced.

---

## Deferred / flagged for follow-up

- 🟡 **Physical `(admin)` route group move.** Blocked on: (a) test coverage for `<Link>` navigation, (b) sign-off on whether URLs should change (`/admin/*` prefix) or stay identical (route-group-only). Recommend a dedicated branch.
- 🟡 **Stripe plan picker "Standard vs Max"**. The brief specifies these tier names but the schema's `tier` enum uses `pilot/starter/pro/enterprise`. That's a data-model mismatch. Cannot autonomously rename an enum used across `subscriptions` rows without a migration + prod data audit. Needs product decision + migration plan.
- 🟡 **Real download URLs.** The download page and outputs page point to `/downloads/present-flow-mac.dmg` and `/downloads/present-flow-win.exe`. These artifacts don't exist yet — the Electron build hasn't shipped. Placeholder hrefs; will 404 until the desktop packager is set up.
- 🟡 **Semantic search UI over sermon archive.** Schema has embeddings (`sermonSummaries.embedding vector(384)`); front-end search box not confirmed to hit vector similarity. Not audited.
- 🟢 **Real-time settings push to desktop.** Currently the desktop polls `churchPreferences` on launch. Real-time push via Supabase Realtime is a future enhancement — documented in the manifest, not built.
- 🟢 **`admin-routes.json` emitter.** The manifest is Markdown; future work is to emit a JSON file the Electron packager can read at build time.

---

## Not done because scope boundary forbade

- Any change to Electron config, operator UI, presenter UI, Bible panel, or `test/`. Confirmed: zero touches.
