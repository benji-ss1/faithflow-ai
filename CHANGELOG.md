# Changelog

## [main] Multi-verse rendering + Bible lookup caches + interim detection + real confidence (2026-07-12)

- **src/lib/server/bible.ts** — `lookupReference` now accepts an optional `chapterEnd`. Single-chapter path unchanged (BETWEEN verseStart..verseEnd). Cross-chapter path issues a single query spanning `(ch=start AND v>=vs) OR (ch BETWEEN start+1..end-1) OR (ch=end AND v<=ve)` so `Col 3:20-4:2` returns 8 verses across the boundary in one roundtrip.
- **src/lib/server/bible-cache.ts** (new) — 500-entry LRU with 1h TTL keyed by `translation:book:ch:vs-ve[:chEnd]`. `warmCache()` prewarms ~50 of the most-cited references (John 3:16, Psalm 23, Rom 8:28, ...) on module load. Idempotent.
- **src/lib/bible-client-cache.ts** (new) — session-scoped in-memory client cache + `cachedLookup()` wrapper for `/api/bible/lookup`. Cap 500; keys match the server cache. Used by BibleMode and the ProOperatorShell scripture auto-router.
- **src/app/api/bible/lookup/route.ts** — accepts `chapterEnd`; checks server cache before hitting the DB; fires `warmCache()` at module load.
- **src/components/operator/pro/center/BibleMode.tsx** — routes through `cachedLookup`; forwards `chapterEnd` from the parser so cross-chapter refs like `Col 4:4-5:2` fan out to N verse cards. Card labels show the correct per-verse `book ch:v` even across chapters.
- **src/components/operator/pro/ProOperatorShell.tsx** — scripture auto-router renders an optimistic "Loading…" placeholder card the instant the detection lands, then replaces it once `cachedLookup` resolves. Cache-hit path resolves synchronously in the microtask queue → no visible flicker. Recent-Detections confidence pill is now color-coded (>=90 green, 70-89 amber, <70 grey).
- **scripts/audio-server.ts** — Deepgram utterance `confidence` is now passed through on `final` messages, and a new `interim_final_candidate` message fires when an interim has >=4 words AND confidence >=0.8 so the client can run detection ~1-2s earlier than the final.
- **src/components/operator/useAudioStream.ts** — handles `interim_final_candidate` by invoking `runDetectAll` with the DG confidence. Scripture suggestions now blend `round(parserConf * dgConf)` (clamped 1..100). Existing SuggestionDedupe by reference key prevents duplicate cards when the same ref appears in interim then final.
- **test/bible-completeness.test.ts** — 3 new DB-backed cases: `lookupReference(Genesis 4:1-7)` returns 7 verses; `Psalms 23:1-6` returns 6; cross-chapter `Col 3:20-4:2` returns >=8 with correct chapter-then-verse ordering.
- **test/bible-perf.test.ts** (new) — 15 cases covering client + server cache hit/miss/key semantics, confidence-blending math including missing-dg and clamp behavior, and lyric-fragment matching against an indexed library.

## [main] Audio bridge auto-start + Live transcript panel + Safe Mode unify + phrase-hit rendering (2026-07-12)

- **electron/main.ts** — dev spawns `scripts/audio-server.ts` via bundled tsx CLI as a managed child (`[ws-server]` log prefix), polls `http://127.0.0.1:3001/` up to 5s for readiness, kills on `before-quit`. Fixes "AI error" in fresh dev environments where nobody remembered to run `npm run ws`.
- **scripts/audio-server.ts** — explicit WS close codes: `1011` for `deepgram key missing` / `auth secret missing`, `1008` for `invalid ticket` / `unknown plan`. Dev no longer hard-exits on missing key; prod still does. New `/health` JSON endpoint reports config status.
- **useAudioStream.ts** — treats close codes 1008/1011 as fatal (no reconnect loop) and surfaces `Audio bridge: <reason>` verbatim. Removes the transient "Reconnecting AI listener (attempt N)…" status string; the AI Live pill is now the sole status indicator.
- **TopBar AI Live pill** — errored state renders "AI Live · offline" with red bg, tiny info dot, and an inline Retry button beside the pill.
- **ProOperatorShell** — new `LiveTranscriptPanel` in the right sidebar between LivePreviewPanel and RecentDetections. Fixed 96px scroll box, monospace font, final text foreground / interim text dim, recording pulse dot. Old `AITranscriptTicker` slimmed to chips-only (transcript text + error text removed to reduce noise; scripture/song chips stay since they're actionable). Hidden entirely when there are no chips to show.
- **SlideGrid** — empty-state tip added: "Tip: click any slide to send it live. Enable Safe Mode in Settings to require double-click."
- **SettingsModal Safe Mode key unification** — the modal was writing `presentflow.safeMode` but SlideGrid + useOperatorHotkeys read `presentflow.operator.safeMode`. Toggling the chip did nothing. Now writes the operator key, migrates any lingering legacy value on open, deletes the legacy key.
- **BibleMode phrase search** — full hit list is rendered (was already looping but capped by `limit: 10` client-side). Added Results limit dropdown (10 / 20 / 50 / 100, default 20) and a summary line "N results for '…' in <TR>". Server route now accepts up to 100 (was capped at 50).
- **test/bible-phrase-search.test.ts** — three new tests cover multi-hit rendering, the `limit` param on the outgoing request, and the 100 cap. 6 tests pass.

## [main] AI Live pill + Bible phrase fix + passage-toggle removal (2026-07-12)

- **TopBar AI Live pill** — replaces the tiny Radio icon with a prominent
  ~90x28 pill (OFF red / CONNECTING amber pulse / LIVE green subtle pulse),
  positioned before the Live/Audience/Stage indicators. Tooltip surfaces
  the current pipeline stage. Added `pf-pulse-live` +
  `pf-pulse-connecting` keyframes.
- **Phrase-search fix** — `/api/bible/search` now accepts translation
  code (resolves to id) and `query` OR `q`, returns both `hits` and
  `results`. Client sends `{ query, translation }` and gates min-3-chars
  before dispatch.
- **Removed verse/passage toggle from BibleMode** — always one verse per
  card. `mode` dropped from `BibleSessionState`.
- **AI pipeline shell routing** — high-confidence scripture detections
  now populate the Bible session cards even if the operator is on a
  different center tab.
- **New test** `test/bible-phrase-search.test.ts` — 3 cases, all pass.

Verified: `npm run typecheck` (one pre-existing jsdom types warning
unrelated to this pass) + `npm run electron:build:tsc` both pass.
Existing tests still green (ai-pipeline 28/28, bible-mode 6/6).

## [main] No-more-scaffolding pass — remove/wire every placeholder (2026-07-12)

Systematic sweep of `data-todo`, "coming soon", and greyed-out UI. Rule of the
pass: wire it or remove it — no more toasts promising features that don't exist.

Wired (real behaviour):
- **BottomBar** view modes (grid/list/text) — active state persists and emits
  `presentflow:slide-view-mode` for consumers.
- **MediaStrip** — now fetches recent assets from `/api/media/list` and each
  tile opens Media Library on click.
- **FeedbackTab screenshot** — file input accepts images up to 4 MB, sent as
  base64 data URL to `/api/feedback`; server-side records size + filename in
  the persisted message (no schema change).
- **Voice command "give me NIV"** — OperatorConsole listens for
  `presentflow:switch-translation` and re-drives its verse-bank hook against
  the new translation code (regex-validated).
- **BibleStore Request** — replaces "Download coming soon" toast with a real
  pre-filled mailto to support@presentflow.app for the requested translation.

Removed (was greyed / lying):
- TopBar icons: Text, Palette (Theme), Edit, Reflow, Arrangement, Export,
  Duplicate slide — all deleted along with the `todo` prop on `IconBtn`.
- TopBar ProContent popover — hidden for Max tier (was "Coming soon — Max
  content marketplace"); non-Max users still see the upgrade prompt.
- BottomBar: Add-slide, Save-As dropdown, Emoji, Filters buttons.
- StageTab: NDI / Syphon / Placeholder new-source buttons.
- MessagesTab: Presets, Upload, Theme placeholder tile.
- MediaSection subcategories: Playlists, Video Inputs.
- LivePreviewPanel: 16/9 / 4/3 / … aspect-ratio placeholder pills.
- MediaStrip Filter button + placeholder tile array.
- CenterHeader "Rename coming soon" toast + read-only input replaced with a
  plain title label.
- BottomDrawer SlideContextMenu Disable/Delete toasts (props omitted).
- OperatorConsole `onDeleteSlide` no longer toasts — no-op with a comment
  pointing at the slide-editor path.
- Theme Designer placeholder route + HelpTab tour entry deleted; middleware
  desktop allow-list trimmed.
- GatedTutorial "Video coming soon" strip + first-sunday page VideoSlot
  fallback both removed (returns `null` when no clip).
- ThemesTab premium tiles for Max users now render a status line
  ("Premium themes are included in your plan…") instead of dead buttons.
- BillingPanel "Coming soon" eyebrow renamed to "Upgrade plans".
- LeftColumn "Playlists coming soon" → "No playlists yet".

Server / API:
- `/api/feedback` accepts optional `screenshot` (data URL) + `screenshotName`;
  size cap 6 MB base64 (~4.5 MB raw); silently drops oversize/malformed
  rather than 400. Appends `[screenshot attached: name, ~N KB]` to persisted
  message. `screenshotKB` added to sanitized console log line.

Verification:
- `npm run typecheck` — pass. Pre-existing unrelated jsdom-types error in
  `test/adversarial/audio-reconnect.test.ts` unchanged.
- `npm run electron:build:tsc` — pass.
- `grep -rn "data-todo" src/` — 0 results.
- `grep -rni "coming soon" src/` — 0 results.

## [main] Reviewer/security follow-ups — R4/R5 + Y1–Y5, Y7 (2026-07-12)

Closed the remaining 🔴/🟡 findings from the reviewer + security pass.

- **R4 (middleware):** `/theme-designer` added to `DESKTOP_ALLOWED_PAGE_PREFIXES`
  so the HelpTab tour + placeholder route no longer bounce to `/operator` in
  the desktop shell.
- **R5 (feedback):** `/api/feedback` now sanitizes the message before logging
  (strips CR/LF/NUL/control chars, truncates preview to 200 chars) and
  persists the submission to a new `feedback` Drizzle table
  (`churchId`, `userId`, `type`, `message`, `blocker`, `email`, `createdAt`).
  Email is no longer written to logs verbatim — only `hasEmail: boolean`.
- **Y1:** Feedback email now validated with a strict regex; returns 400 on
  malformed input.
- **Y2:** Extra per-user 1/day cap on `blocker: true` submissions on top of
  the existing 3/hour cap.
- **Y3 (license):** LicenseTab now stores the license key in Electron's
  `safeStorage` (keychain) via new IPC handlers `license:get|set|clear` in
  `electron/main.ts` and exposed on the preload bridge. Legacy plaintext
  localStorage value auto-migrates on first read and is wiped. Web build
  keeps localStorage (labelled cleartext in the UI). Sign-out clears the
  keychain blob via a new shared `signOutFully()` helper wired into both
  Sidebar + Topbar sign-out handlers.
- **Y4 (AudioTab):** Extracted `parseAudioInput` + `parseCustomCommands`
  validators; rejects unknown shapes on read instead of trusting arbitrary
  localStorage JSON.
- **Y5 (usage):** `/api/usage` now returns real transcription-minutes for
  the current week (segments-per-week via join to `service_plans` scoped by
  `church_id`, ~5s/segment estimate). Context searches and custom themes
  now return `used: null` so UsageTab renders "—" and an "Estimated soon"
  caption instead of fake zeros.
- **Y7 (feedback prefill):** New `/api/me` endpoint returns
  `{ id, email, name }` for the current user. FeedbackTab prefills the
  email field on mount (never overwrites user's own edits).
- **Middleware allowlist:** `/api/me`, `/api/feedback`, `/api/usage` added
  to `DESKTOP_ALLOWED_API_EXACT` so the desktop shell can hit them.

**Tests added:** `test/feedback-validation.test.ts` — 6 tests covering the
sanitizer, the email regex, and the blocker rate-limit primitive.
All 6 pass; existing `test/voice-commands.test.ts` (6) still passes.
`npm run typecheck` clean (only pre-existing jsdom types warning in
`test/adversarial/audio-reconnect.test.ts`, unrelated to this change).
`npm run electron:build:tsc` clean.

**Schema change:** new `feedback` table + `feedback_type` enum. Requires
`drizzle-kit push` (or generated migration + `db:migrate`) before the
`/api/feedback` insert will succeed against a fresh DB. The route
gracefully falls back to a warning log if the insert fails so early
feedback isn't dropped during deploy.

## [main] Settings expansion — 8-tab Pewbeam-inspired modal (2026-07-12)

Major expansion of the operator Settings modal, modeled on Pewbeam reference
screenshots. The modal grew from a small 3-section list to a full 880×640
shell with a left-rail nav and 8 dedicated tabs.

- **New:** 8 Settings tabs — Display, Audio, Language, Usage, Bible Store,
  License, Help, Send Feedback. Selected tab persists to localStorage
  (`presentflow.pro.settings.tab.v1`).
- **Audio tab:** Transcription Mode pill (Online/Offline), Radix-Popover
  Audio Input picker grouped by Microphones & Devices / NDI Audio (Routed)
  / NDI Sources, Input Gain slider, Voice Commands toggle + custom command
  builder with action dropdown, built-in command chip row.
- **Usage tab:** Quota tiles reading from new `/api/usage` — transcription
  minutes/week, context searches/month, custom themes, broadcast outputs.
  Max tier shows "Unlimited"; free/pilot gets Upgrade CTA opening
  MaxUpgradePrompt.
- **Bible Store tab:** Marketplace list — bundled/free (KJV, NKJV, NLT, NIV,
  ESV, NASB) marked Downloaded, paid rows (AMP, AMPC, ASV, HCSB, TPT) with
  Upgrade CTAs. Toast on Download for free-not-yet-cached rows.
- **License tab:** Church name, license key input, activation status pill,
  Deactivate this device placeholder.
- **Help tab:** Dashboard + Theme Designer tutorial restart rows, inline
  Keyboard Shortcuts list (reuses `NAV_ROWS` / `ACTION_ROWS` from
  ShortcutsHelpOverlay), Documentation + Contact Support links.
- **Send Feedback tab:** Problem / Feature-request Tabs, email + textarea,
  blocker toggle, POSTs to new `/api/feedback` endpoint.
- **New endpoints:**
  - `GET /api/usage` — auth-gated; returns tier-appropriate quotas.
  - `POST /api/feedback` — auth-gated; rate-limited 3/hour/user; logs
    server-side. Body `{ type, email?, message, blocker }`.
- **Theme Designer:** placeholder route at
  `src/app/(app)/theme-designer/page.tsx` — full canvas editor deferred.
- **ShortcutsHelpOverlay:** exported `NAV_ROWS`, `ACTION_ROWS`, `ShortcutRow`.
- **Safe Mode:** preserved as a header chip (default OFF).

Deferred to follow-up loops (see DECISIONS.md): Recent Detections sidebar
+ auto-pause after 10 min idle; custom voice commands runtime integration
into `context-parser.ts`; full Theme Designer canvas editor.

Verified: `npm run typecheck` and `npm run electron:build:tsc` both pass.

## [main] PP-parity polish — pass 4 (2026-07-12)

Ships Tasks C (drag-reorder slides), E (visual noise reduction), F remainder
(Max-gated default output dropdown), and B remainder (6px slide-grid gutter).

- **New server action** `reorderItemSlides(planId, itemId, newOrder)` with
  two-hop church ownership guard. Song items persist a per-plan
  `serviceItems.payload.slideOrder` override (NEVER touches church-global
  `songSlides.order`). Scripture/sermon/media items reorder `payload.slides`
  in place.
- **getExpandedServicePlan** honors `payload.slideOrder` for song items,
  with defensive fallback for stale overrides.
- **SlideGrid drag-reorder** via @dnd-kit SortableContext. Optimistic local
  reorder in OperatorConsole, then persist, then router.refresh().
- **Test file** `test/actions.test.ts` — 6 tests for validator.
- **Visual polish** — standardized `hover:bg-white/5`, 16px icons, tighter
  list-row padding (8px), removed redundant border on MediaStrip tiles.
- **6px slide-grid gutter** in both main and stage rows.
- **Max-gated default output dropdown** in TopBar. UI-only; persists to
  `presentflow.pro.defaultOutput.v1`.

Typecheck: clean (pre-existing jsdom warning unchanged).
electron:build:tsc: clean.
Tests: 6 new (actions.test), tier.test (42) still passing.

---

## [main] PP-parity polish — pass 3 (2026-07-12)

Ships Tasks A (prominent search input), D (single-click sends live / Safe
Mode default OFF), G (Present Flow logo popover), Task B partial (slide
number badge + border polish + empty-state copy), and Task F partial
(TopBar right cluster PP-parity pills; sidebar OutputRoutingRow retired to
a localStorage feature flag).

- **TopBar** — new 240×28 prominent search input replacing the small
  Search icon; opens the existing SearchPalette (Cmd+K unchanged). Live pill
  is now clickable (scrolls to preview). Audience/Stage rendered as pills
  with green dot when assigned. Present Flow logo at far right with
  version popover.
- **SlideGrid** — orange numbered badge (18px circle) at top-left of each
  card. Corner radius 6px, 2px brand border when selected, 1px otherwise.
  Empty state text simplified. Debounce (250ms) preserved on send-live.
- **Safe Mode default flipped OFF** across the four localStorage readers
  (`SlideGrid`, `CenterHeader`, `ProOperatorShell` hotkey, `SettingsModal`,
  `BottomDrawer`). ShortcutsHelpOverlay copy updated. Single-click now
  sends live by default; users who want the safety rail opt in from
  Settings.
- **OutputRoutingRow retired** to `presentflow.pro.showRoutingRow=1`
  feature flag — TopBar right cluster is the single source of truth for
  output indicators.

Tasks B (remainder — gutter tightening), C (drag-reorder slides — new
server actions), E (global visual noise reduction), and F (remainder —
Max-gated default output dropdown) deferred to dedicated loops. See
DECISIONS.md for the rationale + the song-reorder persistence rule
(`serviceItems.payload.slideOrder` per-plan override, NOT `songSlides.order`).

Typecheck: clean (pre-existing jsdom warning unchanged).
electron:build:tsc: clean.

---

## [main] PP-parity polish — pass 2 (2026-07-12)

Completes Tasks 3, 4, 5, 6, 7 of the PP-parity backlog.

- **Task 3 (finish) transition duration in broadcast** — BottomBar persists
  `{name, durationMs}` and pushes a full `TransitionSpec` (name+durationMs+
  easing) into shell ctx on any change; `isValidTransitionSpec` added with
  effect-name whitelist and 0..5000ms bounds; `isValidOutputState` now
  validates `state.transition`.
- **Task 4 themes gallery** — `ThemesTab` gets `+ Add New Blank Slide` and
  `+ Create Your Own Theme` Radix Dialogs; custom themes render at the top
  of the swatch grid with a "Custom" badge and hover-delete; blank slides
  under a "My Blank Slides" heading. New shared hook
  `src/hooks/useCustomThemes.ts` (localStorage + storage/custom events).
- **Task 5 Max-gated OutputRoutingRow** — new
  `src/components/operator/pro/right/OutputRoutingRow.tsx` mounted above
  `LivePreviewPanel`. 6 pills (Media / Inhouse Stream / Live / Audience /
  Stage / Status). Non-Max users see ghost pills + lock; click opens the
  `MaxUpgradePrompt` modal via `pro-content` feature key. `tier === null`
  renders a spacer to avoid flash.
- **Task 6 TransitionChooser** — extracted from BottomBar to
  `BottomBar/TransitionChooser.tsx`. Radix Tabs (All / Favorites), name
  filter input, 3-col card grid with star favorites (persisted to
  `presentflow.pro.transitions.favorites.v1`), 11 transitions, empty-state
  copy for Favorites.
- **Task 7 (finish) Bible reference-or-phrase** — new heuristic
  `isProbablyReference` in `src/lib/bible-parser.ts`; `BibleMode` input now
  accepts both, hint text below input, `REFERENCE` / `PHRASE` badge inside
  input, phrase hits render as cards with matched span wrapped in
  `<mark>`.
- **Tests** — `test/projector-output.test.ts` +4 transition cases
  (38 → 42 passing). `test/bible-mode.test.ts` new (6 heuristic cases).

Typecheck: clean (pre-existing jsdom warning unchanged).
electron:build:tsc: clean.

---

## [main] Priority 10 — Present Flow Max tier scaffolding (2026-07-12)

Pure UI + gating scaffolding for the Max tier. No payment processing, no
real feature unlocks — just clean upgrade prompts in the right places
linking out to the web billing portal.

**New files**
- `src/lib/tier.ts` — `Tier` type (`free` | `pilot` | `max`), `MAX_FEATURES`
  set, `isMaxOnly`, `canAccess`, `dbTierToTier` (collapses the DB tier enum
  `pilot | starter | pro | enterprise` into the UI bucket).
- `src/hooks/useTier.ts` — client hook w/ in-memory SWR-lite cache.
- `src/app/api/tier/route.ts` — auth-gated read of the church's
  `subscriptions.tier` + status. Falls open to "free" on any error so the
  UI never flashes privileged content.
- `src/components/tier/MaxUpgradePrompt.tsx` — `card` and `modal` variants,
  plus a `LockedTile` for the Themes premium grid. "Learn more" opens
  `NEXT_PUBLIC_APP_URL/settings/billing` via `electronAPI.shell.openExternal`
  on desktop, `window.open(..., "_blank", "noopener")` on web.
- `test/tier.test.ts` — 21 invariants (feature-gate + DB tier mapping).

**Wired into 3 surfaces**
- Bible → Options → Bibles → Purchased sub-tab: card prompt for non-Max;
  the existing "Activate Present Flow" placeholder is replaced.
- Themes tab: new **Premium** section with Cinematic / Modern / Elegant /
  Youth gradient tiles behind a lock icon; clicking opens the modal
  variant. Max users see them unlocked but greyed-out.
- TopBar ProContent icon: was a disabled `todo` button; now a Popover
  showing the card prompt for non-Max, "Coming soon — Max content
  marketplace" for Max.

**Deferrals**
- Real payment checkout is P7 scope (web admin portal /settings/billing).
- No entitlement enforcement at server-action layer — UI scaffolding only.

## [main] Priority 9 — reviewer/security fixes (2026-07-12)

Follow-up on the Priority 9 review agents: 2 red + 11 yellow findings closed.

**Red**
- R1 OperatorTour: removed the full-viewport click-eater. SVG dimmer +
  spotlight are now `pointerEvents: none` end-to-end; the container has
  `pointerEvents: none` and only the tour card re-enables pointer events.
  Operator can click the highlighted zone while the tour is up. Arrow
  keys / Enter / Escape advance / dismiss; the tour card holds the visible
  Back/Next/Skip buttons.
- R2 Health endpoints: added `src/lib/health-rate-limit.ts`, a shared
  10/min/userId limiter (namespaced `api-health` via `createLimiter` in
  `src/lib/rate-limit.ts`). Applied to `/api/health/db`,
  `/api/health/storage`, `/api/health/deepgram`, and the new
  `/api/health/ai`. 429 with `Retry-After: 60` on exceed.

**Yellow**
- Y1 Tour polling replaced with `ResizeObserver` (target + body) plus
  a `MutationObserver` on `document.body` that re-binds RO when the
  target (re)mounts. 300ms interval gone.
- Y2 Tour: `window.addEventListener("scroll", measure, true)` (capture,
  passive) so inner scroll containers trigger re-measure.
- Y3 Tour keydown: input/textarea/select/contenteditable guard, plus
  `stopPropagation` so shortcut engine can't double-fire.
- Y4 Auto-open timing: `requestIdleCallback` (timeout 800ms) with a
  400ms `setTimeout` fallback. Polling/observers self-heal late target
  mounts so the shorter window is safe.
- Y5 Auto-open gate: only when `ctx.liveSlide.kind === "empty"`. Never
  pops during rehearsal/live projection.
- Y6 DiagnosticsPanel audio inputs: appends browser-mode caveat when
  not in the Electron shell — enumerateDevices returns empty labels and
  can under-report count without prior mic permission. Desktop shell
  detected via presence of `window.electronAPI`.
- Y7 audio-server: `?probe=1` short-circuits inside `wss.on("connection")`
  BEFORE ticket verify and BEFORE `openDeepgram()`. Origin allowlist + IP
  rate limit still apply in `verifyClient`. Sends `{ok:true, probe:true}`
  and closes 1000.
- Y8 AI health check: new `src/app/api/health/ai/route.ts`
  (auth-gated + same rate limit) returns `{ok, code: MISSING_API_KEY}`
  on missing `GROQ_API_KEY`. DiagnosticsPanel switched from POST
  `/api/ai/helpers/improve_readability` to GET `/api/health/ai` — no
  more Groq completion spent on every diagnostics refresh.
- Y9 Supabase reachability: comment on `runRealtime` documenting the
  intent (HEAD is a reachability probe, not an auth probe; anon key not
  bundled into the panel).
- Y10 Electron Help menu: `openHelp` now validates the resolved URL
  against `isStaticSafeHost` + http/https protocol before calling
  `shell.openExternal`. Prevents a misconfigured `NEXT_PUBLIC_APP_URL`
  from routing users to an arbitrary host.
- Y11 Diagnostics page: verified `requireUser()` gate present at
  `src/app/(app)/setup/diagnostics/page.tsx:16`. No change needed.

**Verify**
- `npm run electron:build:tsc` — passes.
- `npm run typecheck` — passes for all fix files; sole reported error
  (`jsdom` missing @types) is pre-existing on `main` (confirmed via
  `git stash && npm run typecheck`) and unrelated.

## [main] Priority 7 — web admin portal verification (2026-07-12)

Verification pass only. No admin surfaces rebuilt; no placeholder pages needed — all 6 admin routes exist, render server-side data, and are web-accessible.

### Surface status

| Surface | Route file | Data query | Empty state | Web-accessible | Notes |
|---|---|---|---|---|---|
| Church Profile | `src/app/(app)/organization/page.tsx` | `churches`, `settings`, `churchPreferences`, `bibleTranslations` | "Not set" fallbacks per Detail | yes | Read-only view; deep edits deferred to Settings — acceptable per PageHeader copy. |
| Team | `src/app/(app)/settings/team/page.tsx` | `users`, `invitations` | Handled inside `TeamManager` client component | yes | Invites filtered by `expiresAt >= now` and `acceptedAt IS NULL`. |
| Billing | `src/app/(app)/settings/billing/page.tsx` + `src/app/(app)/subscriptions/page.tsx` | `subscriptions`, `mediaAssets` | "pilot" default when no row | yes | Stripe checkout via `BillingPanel` → `src/lib/billing-actions.ts` (uses `NEXT_PUBLIC_APP_URL`). |
| Settings | `src/app/(app)/settings/page.tsx` | `settings`, `churchPreferences`, `listTranslations()` | Web shell renders 4 admin link tiles; desktop shell renders operator settings form | yes | Shell-aware via `x-pf-shell` header / `pf_shell` cookie. |
| Analytics | `src/app/(app)/analytics/page.tsx` | `src/lib/server/analytics` (topSongs, topScriptures, etc.) | `List` component renders "No songs used yet." / "No scripture items yet." | yes | 189 LOC page with proper empty rendering. |
| Sermon Archive | `src/app/(app)/archive/page.tsx` + `[id]/` | `listSermonSummaries()` / `semanticSermonSearch()` | "No archived sermons yet…" copy branch | yes | Keyword + semantic search modes both wired. |

### Shared-DB write/read correspondence

| Setting | Web writes | Desktop reads |
|---|---|---|
| Default Bible translation | `churchPreferences.defaultTranslationId` (via `updateChurchPreferences` in `src/lib/actions.ts`) | `src/app/(app)/operator/page.tsx:73` reads same column, joins `bibleTranslations` |
| Church logo | `settings.logoS3Key` (via `updateSettings` in `src/lib/actions.ts:556`) | `src/app/(app)/operator/page.tsx:78` reads `s.logoS3Key`, presigns for output windows |
| Blank BG color | `settings.blankBgColor` | `src/app/(app)/operator/page.tsx:79` reads same column |
| Church name / location | `churches.name/city/country/timezone` | `organization/page.tsx` reads (no operator dependency) |
| Autopilot prefs (`autoApproveEnabled`, `autoApproveThreshold`, `autoSendToLive`, `aiListeningDefault`) | `churchPreferences.*` (via `updateChurchPreferences`) | `operator/page.tsx:108-111` reads all four |

All setting writes on the web hit the exact same columns the desktop `/operator` page reads. Verification passes without live click-through.

### Web-shell accessibility

`src/middleware.ts` `DESKTOP_ALLOWED_PAGE_PREFIXES` only restricts requests where `isDesktopShell(req)` is true (cookie `pf_shell=desktop` or header `x-pf-shell: desktop`). Web requests (no cookie/header) skip the desktop path allowlist entirely — every authenticated `/organization`, `/settings/**`, `/subscriptions`, `/analytics`, `/archive` request falls through to the standard 200 path. Confirmed by code review; dev-server smoke skipped per scope note.

### "Manage your church online" link

- Sidebar entry: `src/components/layout/Sidebar.tsx:499-538`
- Operator settings modal entry: `src/components/operator/settings/SettingsModal.tsx:39-102`
- Operator left-column entry: `src/components/operator/shell/LeftColumn.tsx:337-342`
- URL built from `process.env.NEXT_PUBLIC_APP_URL || "https://presentflow.app"`.
- Invokes `window.electronAPI.shell.openExternal(url)` → preload `electron/preload.ts:33` → IPC handler `electron/main.ts:344` which validates protocol (http/https only), rejects credentials, and enforces a hostname allowlist derived from `NEXT_PUBLIC_APP_URL`. Confirmed hardened per prior audit.

### Manual verification checklist (needs a real operator + admin)

- [ ] Log into web portal (no `x-pf-shell` header) as admin → `/organization`, `/settings/team`, `/settings/billing`, `/subscriptions`, `/analytics`, `/archive` all render 200 and show data.
- [ ] Change Default Bible translation on web `/settings` → open desktop `/operator` → confirm new translation surfaces in Bible search default.
- [ ] Upload/replace logo on web → confirm desktop output windows fetch new presigned logo.
- [ ] Toggle `Auto-approve` and `Auto-send to live` on web → confirm desktop operator picks up new autopilot config on next load.
- [ ] Click "Manage your church online" in desktop shell → confirm URL opens in default browser (not Electron window) and lands on the configured `NEXT_PUBLIC_APP_URL`.
- [ ] Send a team invite from web → verify recipient email arrives via Resend + `/accept-invite` path.
- [ ] Trigger Stripe test-mode checkout from `/settings/billing` `BillingPanel` → confirm redirect back with subscription row updated.

### Genuinely broken

- None identified. Only known "coming soon" is the `AI usage` card in `/subscriptions` (line 27: `Placeholder until formal usage metering lands.`) — expected, documented in-copy.

## [main] Priority 6 — reviewer + security fixes (2026-07-12)

- **R1 wired song-detection into runDetectAll** — `detectAll` in
  `src/lib/ai-detection/index.ts` now calls `detectSongInTranscript()`
  first; exact/substring hits are pushed as `SongMatchResult` and
  merged with the existing `matchSongCue` results via the songId
  dedupe. Live behaviour matches tested behaviour. Dedupe disabled
  on the inner call (`useDedupe:false`) so the outer
  `SuggestionDedupe` is the sole source of truth.
- **R2 replaced `window.location.reload()` with router.refresh +
  optimistic append** — `OperatorConsole.onAddLibraryItem` used to
  hard-reload the page after `addServiceItem`, wiping interim
  transcript state, forcing a mic re-prompt, and dropping
  BroadcastChannel output state (CLAUDE.md rule 8). Now:
  optimistic append into local `plan` state, `setPreview` focused
  on the new item, then `router.refresh()` re-fetches server
  component data without a remount.
- **Y1 tightened triggers** — dropped bare `\bsinging\b` (fired on
  "the choir was singing beautifully"); replaced with
  `(we're|we are|start|now) singing`. Dropped bare
  `\blet(?:'s| us) worship\b` (fired on "let's worship the Lord
  together"); the `let's worship with <title>` form remains.
- **Y2 word-boundary substring + single-word title exact-only** —
  substring path now uses `\bTITLE\b` regex instead of raw
  `String.includes`. Single-word titles are exact-only to prevent
  "grace of God today" matching title "Grace".
- **Y3 LRU-bounded dedupe map** — module-global `dedupeMap` now
  evicts entries older than `DEDUPE_MS * 2` once size >500, with
  a hard LRU cap fallback.
- **Y4 documented church-switch reset path** —
  `resetSongDedupe()` JSDoc now notes that multi-church runtime
  switching should call it. No runtime switcher exists today.
- **Y5 CLAUDE.md rule 7 inline comment** on the double-click
  handler in `ProOperatorShell` — songs never auto-project.
- **Y6 aria-label + focus ring** on AI song chips.
- **Y7 test isolation** — global `beforeEach` runs
  `resetSongDedupe()` before every test; new tests don't have to
  remember.
- **Y8 tooltip truncation** — chip `title` attr capped at 120
  chars to avoid overlong DOM attribute values.
- **Tests**: 17 → 21. Added R1 wiring test, Y1 negative "singing
  beautifully" + "let's worship the Lord", Y2 word-boundary
  rejection. Also fixed pre-existing async-test race so counts
  print after all promises settle.

## [main] Priority 6 — Song detection from speech (2026-07-12)

- **New** `src/lib/ai-detection/song-detection.ts` — trigger-phrase song
  detector. Recognizes 10 trigger patterns ("let's sing", "let us sing",
  "we're going to sing", "let's worship with", "sing the song", "next
  song", "singing", ...), extracts up to 8 candidate title words after
  the trigger, and matches against the church's indexed library via:
  (1) exact title, (2) substring/starts-with, (3) bigram Dice fuzzy
  ≥0.65, (4) first-line lyric fragment. 30-second per-songId dedupe.
- **Operator/pro AI ticker** now renders song + lyric chips alongside
  scripture chips (music-note glyph, title, confidence %, green "AI"
  badge). `data-in-playlist="true"` when songId is already in the plan
  → amber outline + tooltip "already in playlist"; click scrolls to and
  pulses the playlist row for 2s. Click on not-in-playlist chip calls
  `onAddLibraryItem("song", ...)`. Double-click is intentionally
  identical — songs never auto-project (CLAUDE.md rule 7, copyright
  safety).
- **PlaylistSection** rows now expose `data-playlist-item-idx` +
  `data-item-song-id` so the ticker can locate + pulse them.
- **globals.css** adds `presentflow-song-pulse` 2s amber-inset highlight
  animation.
- **Tests** `test/ai-pipeline.test.ts` grew from 9 → 17 (+8 song cases:
  exact, worship-with, longer trailing phrase, empty candidate, no
  trigger, dedup 30s, case-insensitive, fuzzy).

Manual verification checklist:
- [ ] Speak "let's sing Amazing Grace" while AI listening is active →
      music-note chip appears in ticker with confidence badge.
- [ ] Chip shows amber outline when song is already in the plan.
- [ ] Clicking an amber chip scrolls the sidebar to the item and
      briefly pulses it.
- [ ] Clicking a non-amber chip adds the song to the playlist (no
      auto-project).
- [ ] Double-click on song chip does NOT send to live.

## [main] Priority 5 — Reviewer + security follow-ups (2026-07-12)

- **R1** OperatorConsole now populates `nextItem` on every emitted
  `OutputState`. Stage's NEXT header was previously always blank.
- **R2** `sendLowerThird` merges with `lastOutputStateRef.current` so
  announcement / transition / nextItem are preserved when the operator
  sends a lower-third overlay (previously clobbered on every send).
- **Y1** Linux Livestream BrowserWindow falls back to opaque
  `#00000000` — Linux compositors don't reliably honour `transparent:true`.
  OBS chroma-keys the black rectangle instead.
- **Y2** Livestream `lower_third` OBS mode now requires an explicit
  `lowerThird` payload — the text-kind slide fallback (which leaked song
  lyrics into the OBS overlay) is removed.
- **Y3** Stage auto-hides a stale countdown once its target is >60s in the
  past, so a forgotten countdown no longer displays 00:00 forever.
- **Y4** ScreensPanel: changing a display's role now closes the old
  role window first, avoiding stacked outputs on the same display.
- **Y5** Role → display assignments now persist to
  `userData/screens-assignments.json` (plain JSON, no new dep) and reload
  on next launch.
- **Y6** OutputWindow `webPreferences.sandbox: true` — output pages don't
  use `window.electronAPI` (grep-verified), so the extra isolation is safe.
- **Y7** ScreensPanel validates its localStorage blob before writing to
  state; unknown roles / presets / obsModes are rejected or dropped.
- **Y8** OutputWindow `focusable: false` — keyboard focus stays on the
  operator window. `setIgnoreMouseEvents` intentionally NOT set (fullscreen
  coverage on the secondary display is the desired behaviour).

## [main] Priority 5 — Stage + Livestream outputs (2026-07-12)

- `OutputState.nextItem?: { title, type } | null` for stage "NEXT" preview
  metadata (playlist item title + type). `next` (SlidePayload) already
  existed for the stage's slide preview thumbnail.
- `isValidOutputState` now exported, plus bounds:
  - `nextItem.title` 1..500 chars, `type` 1..64 chars
  - `countdownEndsAt` must be finite positive and ≤ now + 24h, or null
- `livestreamUrl(role, appUrl, {obs})` pure helper for OBS-mode URL building.
- `/livestream?obs=lowerthird` route: transparent background, lower-third
  overlay pinned to bottom; renders text slide content when no dedicated
  `lowerThird` payload is present so scripture keys cleanly in OBS.
- Livestream BrowserWindow now created with `transparent: true` +
  `backgroundColor: #00000000` (Projector/Stage remain opaque).
- `screens:assign` IPC accepts optional `obsMode` ("full" | "lowerthird");
  validated + threaded through to `createOutputWindow` and appended to the
  loaded URL as `?obs=lowerthird&bg=transparent` for Livestream.
- ScreensPanel: adds OBS mode column shown only for Livestream role rows;
  persists in existing `presentflow.screenAssignments.v1` localStorage key.
- Stage page consumes `nextItem` in the "Next" pane header — type badge +
  truncated title alongside the next-slide thumbnail.
- Tests: `test/multi-output.test.ts` — 16 cases pass. `projector-output`
  still 38/38.

Manual verification checklist (needs multi-display or OBS to verify):
- [ ] Assign three physical displays to Projector/Stage/Livestream and
      confirm each opens fullscreen on its target display.
- [ ] Send a scripture slide live; confirm Projector shows full slide,
      Stage shows current + next thumbnail + NEXT title/type, Livestream
      full mode shows the slide, Livestream lower-third mode renders the
      text pinned to the bottom on a transparent bg.
- [ ] Point OBS at the transparent Livestream window; luma/chroma key the
      black backdrop and confirm alpha keying works.
- [ ] Start a countdown; confirm the Stage timer updates in monospace and
      the Projector/Livestream are unaffected.

## [main] Priority 4 — reviewer + security agent fixes (2026-07-12)

- R1 DOM-query modal detection: useOperatorHotkeys now checks
  [role="dialog|menu|listbox|alertdialog"][data-state="open"] and defers
  to the overlay's own key handling. Fixes Escape killing live while
  operator only meant to close a picker/palette/menu.
- Y1 shouldIgnore widened to role=textbox|combobox|searchbox and nested
  closest('[contenteditable="true"]').
- Y2 Shift+Enter → new send-live-force action, bypasses Safe Mode.
  Safe-Mode Enter now surfaces a debounced (3s) toast instead of silently
  swallowing. Documented in the shortcuts overlay.
- Y3 Electron Help > Keyboard Shortcuts IPC is queued on did-finish-load
  when the renderer is still loading, plus a 500ms trailing retry.
- Y4 Legacy OperatorConsole keydown handler guarded with positive
  shell !== "web" check — prevents double-fire when shell is undefined.
- Y5 Hook migrated to handlersRef — window keydown listener attaches once,
  reads latest closure via ref instead of re-registering per render.
- Y6 Playlist-mode name reconciled: hook header documents that
  "playlist-mode" decodes to canonical "slides" in ProOperatorShell.
- Y7 Slide-jump bounds clamp verified in ProOperatorShell.
- Y8 Documented presentflow:open-search event-bus pattern as acceptable
  for UI-only actions; forbidden for live-output / server actions.
- Tests: test/keyboard-shortcuts.test.ts extended with 7 new cases
  (role-based ignore, nested contenteditable, Shift+Enter force-send).

## [main] Priority 4 — Global keyboard shortcuts (2026-07-12)

- New `src/hooks/useOperatorHotkeys.ts` — single global hotkey hook mounted
  in `ProOperatorShell`. Exposes pure `decodeShortcut()` + `shouldIgnore()`
  so key-decoding logic is unit-testable without a browser.
- New `src/components/operator/pro/ShortcutsHelpOverlay.tsx` — Radix Dialog
  listing every binding, dismissible via Escape / click-outside.
- Wired shortcuts: Space/→ next · ← prev · Enter send-to-live (Safe-Mode
  gate) · Esc kill · B blank · L logo · Cmd/Ctrl+K search · Cmd/Ctrl+B|M|S|P
  center-mode switch · 1–9 jump-to-slide · ? open help.
- `TopBar` Cmd+K listener refactored to consume a `presentflow:open-search`
  window event so the centralized hook is the single source of truth.
- Legacy `OperatorConsole` global `onKey` handler now no-ops when the
  desktop (Pro) shell is active — prevents double-fires.
- `BottomBar` gains a "?" HelpCircle button in the right-hand cluster.
- `electron/main.ts` Help menu gains "Keyboard Shortcuts" (⌘/ · Ctrl+/)
  → sends `shell:open-shortcuts-help` IPC that the shell listens for.
- New `test/keyboard-shortcuts.test.ts` — 31 assertions cover every mapping
  in the spec plus input-guard and negative cases. All pass.

## [main] Priority-3 review-agent fixes (R1+R2, Y1–Y10) (2026-07-12)

- **R1 (TopBar green dot)** — dot now green only when `dgMessagesReceived > 0`
  or stage is `receiving_interim`/`receiving_final`. Handshake stays amber.
- **R2 (Psalms parser)** — `normalize()` now fuses space-separated tens+ones
  ("twenty three" → "twenty_three"). Added Psalms whole-chapter guard in
  `parseReference` when no `:` / "verse" marker is present.
- **Y1** — 15s stall watchdog armed at `start()`; sets error + reconnects if
  Deepgram-ready never arrives.
- **Y2** — non-`log()` console calls now routed via a `isDevOrTraceOn()` gate.
- **Y3** — removed the hard-coded "Healthy" dot from TopBar (no real signal).
- **Y4** — in-memory single-use replay guard on ticket sigs in audio-server.
- **Y5** — ticket HMAC now binds `userId`; ticket route pre-verifies plan
  ownership (`servicePlans` row scoped to `user.churchId`).
- **Y6** — `presentflow.aiTrace` localStorage entry now supports
  `{value, exp}` envelope with 1h auto-expire.
- **Y7** — audio-server transcript slice log gated behind DEBUG in prod.
- **Y8** — WS `verifyClient` origin allowlist (localhost + `presentflow.app`
  + `EXTRA_ALLOWED_ORIGINS` + null-origin for Electron).
- **Y9** — sig format validated (64 hex chars) before `Buffer.from` +
  `timingSafeEqual` now uses `hex` encoding.
- **Y10** — per-IP rate limit (10/60s) enforced during upgrade with 429.

**Breaking wire change**: ticket format now includes `userId` in the HMAC
payload. Old-shape tickets return 401 — acceptable given the 5-minute TTL.

## [main] Priority-3 AI listening pipeline — hardening + surfaces (2026-07-12)

7-stage AI listening pipeline verified. Client-side hook (`useAudioStream`) and
Fly-hosted bridge (`scripts/audio-server.ts`) already numbered logs 1–9; wrapped
them in a `PF_AI_TRACE` gate (env / `localStorage.setItem("presentflow.aiTrace","1")`),
default on in dev, off in prod.

### Changes
- `src/components/operator/useAudioStream.ts` — logs now go through
  `PF_AI_TRACE` gate; prefix renamed `[presentflow-audio]` → `[ai-pipeline]`
  inside `start()` (rest of the file — `stop()`, `scheduleReconnect()` —
  still uses the older `[presentflow-audio]` prefix; not load-bearing for
  this priority).
- `src/components/operator/pro/TopBar.tsx` — AI radio icon now surfaces
  4 states: idle (grey) / connecting (amber) / listening+ready (green) /
  error (red). Tooltip shows the error text. Click during error re-attempts.
- `src/components/operator/pro/ProOperatorShell.tsx` — new
  `AITranscriptTicker` component pinned above `BottomBar`. Shows last ~140
  chars of transcript + up to 3 scripture verse chips with confidence % +
  green "AI" badge. Hidden when the listener is idle.
- `test/ai-pipeline.test.ts` — 9 tests: numeric & spoken reference forms,
  no-false-positive on junk speech, confidence-threshold filter, WS URL
  fallback, PipelineStage union contract. All pass.

### Env state (local)
- `DEEPGRAM_API_KEY` — present
- `NEXT_PUBLIC_AUDIO_WS_URL` — `ws://localhost:3001` (local dev; Fly URL
  `wss://faithflow-audio.fly.dev` mentioned in scope but not currently set
  in `.env.local`).

### Stage-by-stage verification (from code review)
| Stage | State | Notes |
|-------|-------|-------|
| 1 mic capture | wired | `getUserMedia` with `sampleRate: 16000`, PCM16 via inline AudioWorklet |
| 2 WS to bridge | wired | HMAC-signed ticket via `/api/audio/ticket`, exponential backoff reconnect |
| 3 bridge → Deepgram | wired | Raw WS to `wss://api.deepgram.com/v1/listen`, `linear16` `nova-2` |
| 4 Deepgram transcript | wired | Interim + final surfaced |
| 5 Transcript render | NEW | Ticker in ProOperatorShell + existing `AIAssistantPanel` |
| 6 Reference parser | wired | `parseReferences` + semantic fallback via pgvector |
| 7 Verse cards | wired | `AITranscriptTicker` chips + existing `AIAssistantPanel` cards |

### Manual verification checklist (test locally)
- [ ] Run `npm run ws` (audio bridge on :3001)
- [ ] Set `NEXT_PUBLIC_AUDIO_WS_URL=wss://faithflow-audio.fly.dev` for prod
- [ ] Confirm Fly.io bridge has `DEEPGRAM_API_KEY` in secrets: `fly secrets list`
- [ ] Launch Electron, log in, click AI toggle in top bar (Radio icon)
- [ ] Grant mic permission (Electron pre-approves)
- [ ] Speak "John three sixteen" — expect ticker text + verse chip w/ AI badge
- [ ] Speak "Psalm twenty three" — expect Psalms chip (known parser quirk:
      chapter reads as 20 verse 3; documented in DECISIONS.md)
- [ ] Speak junk — expect no chip
- [ ] Kill audio server briefly — expect red dot, error toast in ticker
- [ ] Restart audio server — expect auto-reconnect (up to 8 attempts)

## [main] Priority-2 projector output window — fix pass 3🔴/12🟡 (2026-07-12)

- **R1 (electron/output)**: single-display fallback keyed off `screen.getAllDisplays().length === 1` only. Multi-display + primary-as-projector now fullscreens the primary display as the operator explicitly requested.
- **R2 (operator)**: Operator now sees a persistent amber "Msg <text> [Hide]" badge (top-right, next to Sync) while a message overlay is pinned. Countdown-driven overlays auto-clear the badge; `Never` overlays require explicit Hide.
- **S1 (electron/output)**: `will-navigate` clamps every output BrowserWindow to the app origin; `setWindowOpenHandler` denies popups; devtools force-close in packaged builds.
- **Y1**: `fullscreenable: !singleDisplay` (was always-true no-op).
- **Y2**: DevTools closed on open in packaged output windows.
- **Y3/Y11/Y12**: `isValidOutputState` now enforces aspectRatio allowlist, validates `next`/`announcement`/`lowerThird`, rejects prototype-pollution keys. `isValidSlide` validates `text` ≤ 5000, `bgColor` regex, `url` protocol ∈ {https,http,blob}. Message overlays capped at 2000 chars and 24h dismiss timer.
- **Y4**: `/live`, `/stage`, `/livestream` reopen their BroadcastChannel after 5s of silence (bounded to 20 reopens).
- **Y5**: `sendMessage`/`clearMessage` now fan out to paired projectors via realtime (embedded in `operatorMessage`).
- **Y6**: `liveItemIdx` memoized — no more `JSON.stringify` in the render path.
- **Y7**: message send in operator validated via `isValidMessageOverlay`; malformed payloads never reach the wire.
- **Y8**: Realtime channel names now church-scoped: `ff-out-<churchId>-<code>`. Legacy `ff-out-<code>` supported when churchId omitted. SyncControl embeds `&church=` in QR/URL so remote projectors join the correct scoped channel.
- **Y9**: Realtime payloads validated with `isValidOutputStateExternal` before hitting subscribers.
- **Y10**: `/live`, `/stage`, `/livestream` removed from `PUBLIC_PATHS` — Electron output windows continue to work (session cookies), external browsers redirect to `/login`.
- **Tests**: `test/projector-output.test.ts` grew 23 → 38 covering aspectRatio, __proto__, message bounds, javascript/data/file URL, CSS injection.

## [main] Priority-2 projector output window (2026-07-12)

Closes the projector output loop: operator → chromeless output window on
assigned display → live slide rendering with all content types + message
overlay + aspect ratio.

### Electron
- `electron/windows/OutputWindow.ts`: chromeless (`frame:false`,
  `autoHideMenuBar`, `setMenuBarVisibility(false)`) + true fullscreen when the
  assigned display is external. Single-display fallback: opens a 960x540
  draggable windowed frame with a descriptive title so the operator can push
  it onto a second monitor when connected. Fullscreen no longer applied on
  the primary display (which was covering the operator UI).

### Broadcast plumbing
- `src/lib/broadcast.ts`: added `MessageOverlay` type + `{type:"message"}`
  variant on `LiveMessage`. New `isValidLiveMessage()` runtime validator so
  output pages reject malformed / unknown-kind payloads instead of crashing.
- `src/app/live/page.tsx`: validator-gated onmessage handler; renders
  aspect-ratio-aware canvas (letterboxes to 4:3 when operator selects);
  renders lower-third message overlay on top of current slide with
  client-side auto-dismiss timer.
- `src/app/stage/page.tsx`, `src/app/livestream/page.tsx`: same validator
  gate.

### Operator
- `src/components/operator/OperatorConsole.tsx`: new `sendMessage(text,
  dismissAfterMs)` + `clearMessage()` callbacks, wired into `shellCtx`.
- `src/components/operator/shell/types.ts`: `OperatorShellCtx` gains
  `onSendMessage` + `onClearMessage`.
- `src/components/operator/shell/RightInspector.tsx`: MessagesTab gains a
  "Projector message overlay" section (textarea + auto-hide selector +
  Show / Hide).

### Tests
- `test/projector-output.test.ts`: 23 assertions covering validator happy +
  adversarial paths, role→URL sanity, aspect-ratio flow. All pass.

### Manual verification checklist
- [ ] Open Screens modal, assign a display as Projector — new window opens
  chromeless on that display.
- [ ] Single-display case: window opens as a 960x540 titled window,
  draggable to a second display when one is connected.
- [ ] Double-click a Bible verse in the operator — verse appears on
  projector.
- [ ] Double-click a song slide — lyrics appear.
- [ ] Click X (kill) in LivePreviewPanel — projector goes black.
- [ ] Click Logo in ActionBar — church logo shown on projector.
- [ ] Show a message overlay from the Messages tab — lower-third appears
  on top of the current slide.
- [ ] Auto-dismisses after chosen duration (5s / 10s / 30s / 60s).
- [ ] Manual Hide clears the overlay immediately.
- [ ] Toggle 4:3 aspect — projector letterboxes to 4:3.

### Verified
- `npm run typecheck` — only pre-existing `jsdom` types error, unrelated.
- `npm run electron:build:tsc` — passes.
- `npx tsx test/projector-output.test.ts` — 23 passed, 0 failed.

## [main] Bible Priority-1 review fixes (2026-07-12)

Closes all reviewer + security findings on the Priority-1 Bible completeness work.

### Security / integrity
- `scripts/fix-bible-book-names.ts`: hard `--confirm` guard; refuses to run
  without it and prints the target DB host (Y7). Extended RENAME map to cover
  ordinal forms (1st/2nd/3rd) and "Song of Songs" / "Canticle of Canticles" /
  "Psalm" (Y1). Verify step now hard-fails when a populated translation is
  missing books (Y2). Raw `CREATE INDEX` statements removed — indexes now
  live in the Drizzle schema (R1).

### Parser
- `src/lib/bible-parser.ts`: dropped 2-letter aliases that collide with common
  English words (`is`, `am`, `re`, `ex`, `ac`, `ru`) to eliminate live-service
  false positives (R2). Added ordinal number-words up to `hundredth` for Psalm
  navigation (Y5). Overlap dedup rewritten to compare start/end intervals
  instead of `indexOf(matchedText)` (Y4). New cross-chapter range parser:
  `John 3:16-4:3` → `{chapter:3, verseStart:16, chapterEnd:4, verseEnd:3}`
  (Y3). `parseReference` short-circuits empty/whitespace input.

### Schema
- `src/lib/db/schema.ts`: `bible_verses` gains two indexes via Drizzle:
  `idx_bible_verses_lookup (translation_id, book_order, chapter, verse)` and
  `idx_bible_verses_book_lower (LOWER(book), chapter, verse)` (R1). Two
  targeted `CREATE INDEX CONCURRENTLY` statements documented in
  DECISIONS.md for rollout to the populated production DB.

### Tests
- `test/bible-completeness.test.ts`: 20 → 29 tests. Added per-book presence
  sweep for KJV + ASV, empty/whitespace input, R2 false-positive suppression,
  Roman-numeral prefix, and cross-chapter range. All 29 pass.

## [main] Operator/Pro: Pass 2 wiring — top-bar, left, right tabs, bottom-bar (2026-07-12)

Second wiring pass. Every button in the Pro shell now either performs a real
action or is explicitly greyed with a "coming soon" tooltip (no silent no-ops).

### New (functional)
- **TopBar** — Cmd+K global search palette (`SearchPalette.tsx`, uses `cmdk`);
  Sections: Playlist / Bible (common refs) / Songs (`/api/songs/list`) / Media
  (`/api/media/list`). Selecting switches center mode or jumps preview.
- **TopBar** — More menu (Print via `window.print()`, Show diagnostics alert;
  Export & Duplicate slide greyed with tooltip).
- **TopBar** — Screen picker dropdown enumerating `window.electronAPI.screens.list()`,
  persists chosen id to `presentflow.pro.previewDisplay` in localStorage.
- **TopBar** — AI listening indicator is now a click-toggle bound to
  `ctx.onListenToggle`.
- **TopBar** — Audience/Stage indicator dots reflect display count.
- **Left/LibrarySection & PlaylistSection** — "+" opens Radix dropdown/popover
  with From Songs / From Bible / From Media / Blank; Songs/Bible/Media route via
  `onCenterMode`, Blank calls `addServiceItem(planId,"blank",...)`.
- **Left/PlaylistSection** — right-click context menu on playlist items:
  Remove (`removeServiceItem`), Move Up/Down (`reorderServiceItems`), Duplicate
  (`addServiceItem` with copied payload — see DECISIONS for rationale on not
  creating a separate `duplicateServiceItem` action).
- **Left/MediaSection** — subcategory rows (Cinematic/Free/Creators/Intro Videos)
  route to Media mode via `onCenterMode`; Playlists and Video Inputs greyed.
- **BottomBar** — transport Prev/Next wired to `ctx.onJumpSlide` with bounds
  guards; "Verse < / >" also wired to same. Center transport (Play → send-to-live,
  Pause → blank) wired to existing ctx handlers.
- **BottomBar** — Transition popover (Fade/Dissolve/Slide/Cut/Amoeba/Wipe + 0-5s
  slider), persisted to `presentflow.pro.transition.v1`. Displayed value reflects
  setting.
- **BottomBar** — Grid/List/Text view toggle state added (Grid live; List/Text
  greyed pending SlideGrid multi-mode support).
- **MacrosTab** — Radix Dialog add form with Name / Trigger (hotkey|onSlideShow) /
  Action (goToSlide|startTimer|sendMessage|killLive); persisted to
  `presentflow.pro.macros.v1`; delete + item count live.
- **MessagesTab** — Token dropdown ({{time}}/{{date}}/{{currentSlide}}) inserts
  at caret; Dismiss auto-hides after chosen duration via setTimeout.

### Explicit "coming soon" (greyed, tooltip)
- TopBar: Text popover, Theme selector, Arrangement, Edit, Reflow, ProContent.
- BottomBar: Add slide, Save As, Emoji, Filter.
- Left/Media: Playlists, Video Inputs subcategories.
- Right/Themes tab (unchanged from previous pass), Right/Audio tab (unchanged),
  Right/Stage NDI/Syphon/Placeholder buttons.
- MediaStrip: cards + Filter (Media mode above supersedes this strip for now).

### Verify
- `npm run typecheck` — passes (pre-existing jsdom warning only).
- `npm run electron:build:tsc` — passes.

### Deferred (not shipped, documented)
- `updateSlideStyle`, `duplicateSlide`, `addSlideToItem`, `duplicateServiceItem`
  server actions — not created. Rationale in DECISIONS.md.
- Text/Theme popovers, Slide Editor Dialog, Reflow algorithm, Split-screen
  center layout, Bible verse navigation buttons in bottom bar (already covered
  by main verse < / > which advances any slide), full media strip with real
  thumbnails, video-input enumeration, message overlay broadcast to live output,
  themes collections API, full audio import + playback.

## [main] Operator/Pro: Songs/Bible/Media prominent buttons + centerMode routing (2026-07-12)

Wiring pass 1 of 2 — focused on demo-critical inline browsers. The right sidebar,
bottom bar, and media strip are untouched (separate agent's scope).

### New
- `CenterMode` extended from `"slides" | "bible"` to `"slides" | "bible" | "songs" | "media"`.
- `TopBar` gains a **prominent labeled button group** (Songs / Bible / Media) with
  icons + text at ~34 px tall between the icon-only auxiliary groups. **Bible is
  emphasized** (larger min-width, bold label, brand-accent border-bottom on active).
  Clicking again returns to slides.
- `BibleMode` — Reference / Browse tab switcher. Browse mode renders a three-column
  book → chapter → verse picker via new `BibleBookBrowser`; clicking a verse loads
  it into the reference cards (same code path as typing + Lookup).
- `BibleBookBrowser.tsx` (new) — OT/NT collapsible book list, chapter grid, verse
  grid. Chapters cached in a `Map` per translation to avoid re-fetch.
- `SongsBrowser.tsx` (new) — search + list + preview slides column. Click select,
  double-click adds to playlist, "Add to playlist" button on the preview header.
- `MediaBrowser.tsx` (new) — filter + kind dropdown (All / Images / Videos), grid
  of thumbnails. Click select; overlay "+ Playlist" button when selected;
  double-click sends to live.
- `CenterHeader` — mode-aware title + icon for songs/bible/media; rename toast is
  suppressed in library modes.

### API
- `GET /api/bible/books` — now accepts `?translation=KJV` (code) in addition to
  the legacy `translationId`. Returns `{ book, bookOrder, chapters, testament }`.
- `GET /api/bible/chapters?book=John&translation=KJV` (new) — returns
  `{ chapter, verseCount }` derived on-the-fly via `GROUP BY chapter`.

### Files changed
- `src/components/operator/pro/ProOperatorShell.tsx` — 4-way center router
- `src/components/operator/pro/TopBar.tsx` — ModeBtn + prominent group
- `src/components/operator/pro/center/BibleMode.tsx` — Reference/Browse tab, refactored `runLookup`
- `src/components/operator/pro/center/CenterHeader.tsx` — mode-aware header
- `src/components/operator/pro/center/BibleBookBrowser.tsx` (new)
- `src/components/operator/pro/center/SongsBrowser.tsx` (new)
- `src/components/operator/pro/center/MediaBrowser.tsx` (new)
- `src/app/api/bible/books/route.ts` — code-based translation param
- `src/app/api/bible/chapters/route.ts` (new)

## [main] Operator: ProPresenter-style shell rebuild (pro/)

New desktop operator layout at `src/components/operator/pro/`:
- TopBar (44px) — left icon group (Search/Text/Theme/Arrangement/Show/
  Edit/Reflow/Bible/More), right group (ProContent/Media toggle/Screen
  selector/Live/Audience/Stage/AI-listening/status).
- Left panel (~180px) — Library / Playlist (from ExpandedPlan.items,
  active row = orange left-border) / Media (subcategories).
- Center — inline-editable item header + slide grid with
  ContextMenu (Delete wired to existing Delete-key confirm) + stage
  mirror row at half size. Bible mode swaps in a reference input,
  translation + verse/passage + reference-format controls, and a
  Bible Options popover (SLIDE OPTIONS + BIBLES tabs, localStorage).
- Right sidebar (~320px) — live preview thumb (X to clear) + 6-tab
  dock: Audio / Stage (resolution + detected displays via
  electronAPI.screens.list() + Configure Screens dialog wrapping
  existing ScreensPanel) / Timers (mm:ss countdown, localStorage) /
  Messages (persisted state) / Themes (swatch grid) / Macros.
- BottomBar (40px) — transport controls, transition label, prev/next
  verse, slide-size slider (96–240px, writes --slide-thumb-size CSS var).
- MediaStrip (140px, collapsible, persisted).

Composition-only: reuses the existing OperatorShellCtx from
OperatorConsole so audio, verse bank, autopilot, safe mode, broadcast,
pair-code sync, keyboard shortcuts, and end-of-service persistence all
continue to work unchanged. Legacy `OperatorShell` is retained for
`/services/[id]/operate` (unused today per middleware) but is no longer
mounted at `/operator`.

Placeholders (data-todo="1" attribute, tooltip / visible copy):
Search/Text/Theme/Arrangement/Edit/Reflow/More top-bar icons; Media
subcategories; audio playback; NDI/Syphon/Placeholder rows; Messages
"New Message"; Themes swatches; Macros list; MediaStrip thumbnails;
transport buttons; view toggles.

## [main] Operator shell: reviewer + security fix pass (3 red, 10 yellow)

Addressed all reviewer + security findings on the operator shell rebuild.

### Security

- **actions.addServiceItem** — added discriminated-union payload guard and
  church-scoped ownership check on referenced library items (songId /
  mediaAssetId / pptxImportId). Rejects cross-church ids and type↔payload
  mismatches. `src/lib/actions.ts`.
- **middleware** — replaced prefix API allowlist with an EXACT set for the
  desktop shell (narrow prefixes only for NextAuth callbacks and legitimate
  dynamic-segment routes verified against `src/app/api/**/route.ts`). Dropped
  `/onboarding` from the desktop page whitelist (admin surface). Hardened
  `pf_shell` cookie with `httpOnly` + `secure` (prod) + `sameSite: lax`.
  `src/middleware.ts`.
- **electron/ipc/screens** — validated `role` and `preset` against the type
  unions on `screens:assign`, `screens:spawn`, `screens:close`. Any other
  value now returns `{ok:false, error:...}`. `electron/ipc/screens.ts`.
- **electron/main** — `NEXT_PUBLIC_APP_URL`-derived hosts are now filtered
  through a static safe-list (`localhost`, `127.0.0.1`, `*.presentflow.app`,
  `*.presentflow.com`) before being added to first-party or external-URL
  allowlists. `shell:openExternal` also honors the safe-list for wildcard
  matches. `electron/main.ts`.

### Reviewer UX / correctness

- **Safe Mode ON by default** — missing localStorage key now means Safe Mode
  is ON (double-click stages to Preview only). Users must explicitly disable
  Safe Mode from Settings to enable double-click-to-live. Added a 250ms
  debounce to reject accidental repeat fires. `src/components/operator/shell/
  BottomDrawer.tsx`, `src/components/operator/settings/SettingsModal.tsx`.
- **SlideContextMenu Delete** — Delete now opens a Radix `AlertDialog`
  confirm ("Delete this slide? This cannot be undone.") with Cancel /
  Delete. Focus + `Delete`/`Backspace` key on the trigger also opens the
  confirm. `src/components/operator/SlideContextMenu.tsx`. Added dep
  `@radix-ui/react-alert-dialog`.
- **SettingsModal accessibility** — migrated from a custom overlay to
  Radix `Dialog` (role, aria-modal, focus trap, ESC-to-close, backdrop
  close). `src/components/operator/settings/SettingsModal.tsx`.
- **Tray "Open Screen Config"** — no longer navigates to `/settings/screens`
  (blocked in desktop shell). Sends `shell:open-screens-modal` IPC; the
  renderer opens the existing Screens modal in the top toolbar directly.
  `electron/main.ts`, `src/components/operator/shell/TopToolbar.tsx`.
- **Operator page SQL filter** — today's plan is now filtered in SQL by
  `scheduledFor = todayKey` (church tz) with `ORDER BY id ASC LIMIT 1`,
  eliminating a fetch-all-plans read. Same deterministic tiebreak.
  `src/app/(app)/operator/page.tsx`.
- **Eliminate flash of web chrome** — server layout reads the `pf_shell`
  cookie / `x-pf-shell` header, passes `initialShell` to `AppShell`, and
  `useShell()` seeds state from it. Desktop shell now paints correct chrome
  on first frame. `src/app/(app)/layout.tsx`, `src/components/layout/
  AppShell.tsx`, `src/hooks/useShell.ts`.

### Verification

- `npm run typecheck` — passes (existing jsdom warning unchanged).
- `npm run electron:build:tsc` — passes.

## [main] Operator shell: deferred spec items delivered

Six user-visible items that were deferred from the initial ProPresenter-style
rebuild are now shipped.

### 1. Inline library panels (Songs / Media / Imports)
- `src/components/operator/shell/LeftColumn.tsx` — Library rows now expand
  inline as accordions. Songs (search + list), Media (grid), Imports (list w/
  status + date). Only one open at a time. Bible still opens the overlay.
- `src/app/api/songs/list/route.ts` (NEW) — desktop-safe `{id,title,artist}`.
- `src/app/api/imports/list/route.ts` (NEW) — desktop-safe pptx list.
- `src/app/api/media/list/route.ts` — reused as-is.

### 2. Right-click context menu on slides
- `src/components/operator/SlideContextMenu.tsx` (NEW) — Radix ContextMenu
  wrapper. Items: Edit, Disable, Themes ▶, Transitions ▶, Delete.
- Wired into `CenterWorkspace.tsx` (slide list rail) and `BottomDrawer.tsx`
  (Media grid). Disable / Themes / Transitions stubbed — see DECISIONS.md.

### 3. Live output thumbnail (always visible, top-right)
- `src/components/operator/LiveOutputThumb.tsx` (NEW) — 200×112 SlideRenderer
  proxy for the last-sent slide, red border when Live, "Off-Air" otherwise.
- `OperatorShell.tsx` places it above `RightInspector` on the right column.

### 4. Drag-to-add from library into playlist
- LeftColumn library rows are `draggable`, write a `LibraryDrag` payload to
  `application/x-presentflow-library`. Playlist section accepts the drop and
  calls `ctx.onAddLibraryItem(kind, {id,title})`.
- `OperatorConsole.tsx` implements `onAddLibraryItem` via `addServiceItem`
  server action + `location.reload()`. Ephemeral plan shows a toast prompt.

### 5. Screens/Outputs modal from the top bar
- `src/components/operator/screens/ScreensPanel.tsx` (NEW) — extracted core
  of `/settings/screens/page.tsx`. Reads `window.electronAPI.screens`.
- `TopToolbar.tsx` — new Monitor icon opens a modal wrapping `ScreensPanel`.
- Standalone `/settings/screens/page.tsx` untouched (web shell still uses).

### 6. Help "?" dropdown at LeftColumn bottom + Electron menu parity
- LeftColumn: `HelpDropdown` (icon at bottom of aside, Electron-only) mirrors
  the Electron Help menu items — opens each via
  `window.electronAPI.shell.openExternal(NEXT_PUBLIC_APP_URL + <path>)`.
- Hidden in web shell (no `window.electronAPI`).

### Deps
- Added `@radix-ui/react-context-menu`. No other installs.

## [main] Desktop shell → single ProPresenter-style operator view

Reshapes the Electron desktop shell to render one always-visible operator surface
instead of the previous multi-page workspace navigation. Web build (Vercel) is
unaffected — all library / setup / settings / help pages remain live for it.

### Layout / routing
- `src/app/(app)/operator/page.tsx` — no longer redirects to `/services/[id]/operate`
  and no longer renders the "ready to present" empty state. Always renders
  `OperatorConsole` directly. When no plan is scheduled for today an ephemeral
  empty plan (`id="__ephemeral__"`) is passed so the operator lands in the
  single-view layout and can start populating from the left library panel.
- `src/components/layout/AppShell.tsx` — when `useShell() === "desktop"` renders
  children full-bleed with NO sidebar and NO topbar chrome. Web unchanged.
- `src/middleware.ts` — desktop `DESKTOP_ALLOWED_PAGE_PREFIXES` reduced to
  `/operator`, `/onboarding`, `/_next`, `/favicon`. All `/services/*` subpaths
  now blocked in desktop EXCEPT the explicit `/services/[id]/operate` regex.
  So `/library/*`, `/setup/*`, `/tutorial`, `/help/*`, `/dashboard`,
  `/settings*`, `/organization`, `/team`, `/analytics`, `/archive`,
  `/subscriptions`, `/products`, `/applications`, `/profile`,
  `/services`, `/services/[id]`, `/services/new` all 307 → `/operator`.

### Operator UI
- `src/components/operator/settings/SettingsModal.tsx` (NEW) — dialog surface
  with a Safe Mode toggle and a "Manage your church account online" link that
  opens the web portal via `window.electronAPI.shell.openExternal`.
- `src/components/operator/shell/TopToolbar.tsx` — replaced the
  `/settings/screens` Link with a gear button that opens the SettingsModal.
  Back-link to `/services/[id]` hidden when the plan is ephemeral.
- `src/components/operator/shell/BottomDrawer.tsx` — slide thumbnails now
  respond to double-click by sending to Live (ProPresenter default). Safe
  Mode (localStorage `presentflow.safeMode=1`) reverts double-click to
  Preview-only. Single-click still stages to Preview.

### Electron
- `electron/main.ts` — installs a proper application menu (File / Edit / View /
  Help). Help items (`Guided Tutorial`, `First Sunday Playbook`,
  `Projector Setup`, `Microphone Setup`, `Install Diagnostics`) open the
  corresponding pages on the web portal via `shell.openExternal`, NOT via
  window.loadURL — the desktop window never navigates away from the operator.

### Manual verification checklist
Cannot GUI-verify from headless. When the user runs the built app:

1. Launch Electron; window opens on `/operator` (not redirected).
2. If today's plan exists, its items appear in the left Playlist panel.
   If not, playlist is empty and title shows "New service".
3. NO global sidebar visible (was 300px wide previously); operator uses the
   full window width.
4. In dev browser (web shell): visit `/library/songs` → still works (200).
   In Electron (desktop shell): visit `/library/songs` → redirects to
   `/operator`. Verify with `curl -H "x-pf-shell: desktop" localhost:3000/library/songs`
   after authenticating — expect 307 with Location: /operator.
5. In the operator top bar, click the gear icon → Settings modal opens.
   Toggle Safe Mode → localStorage `presentflow.safeMode` flips to `1`.
   Click "Manage your church account online" → external browser opens the
   web portal (guarded by `shell:openExternal` allowlist).
6. Double-click a slide thumbnail in the bottom drawer with Safe Mode OFF
   → slide goes live immediately (red border on projector).
   Turn Safe Mode ON → double-click only stages to Preview.
7. Application menu (macOS: PresentFlow menu bar) shows Help → menu items
   open the tutorial etc. in the system browser, not in the app window.

### Known gaps (deferred, not delivered here)
- Inline Songs / Media / Imports browsers INSIDE the left panel (spec
  wanted collapsible groups with searchable lists inline). Today the
  existing `LeftColumn` shows a list of library category buttons that
  jump to the (still-in-code) library pages OR open the Bible drawer;
  it does NOT yet render inline song/media/imports lists. Bible already
  opens inline. Follow-up needed: reuse `library/BiblePanel.tsx` pattern
  for Songs, Media, Imports. See DECISIONS.md.
- Right-click context menu on slides (Edit / Disable / Themes /
  Transitions / Delete). Requires `@radix-ui/react-context-menu`
  (not currently installed) + wiring across `SlideCanvas` +
  `BottomDrawer` thumbnails. Deferred.
- Top-right live-output preview thumbnail. Existing `RightInspector`
  already surfaces live/preview state; a dedicated always-visible
  thumbnail widget in the top-right area is not yet added.
- Drag-to-add from library into playlist.
- The "?" help icon in the left panel bottom (Electron menu already
  provides Help; this UI hook not added).
- Screens/Outputs button opens a proper modal (today it's still the
  gear-based settings modal, which mentions Screens lives on the web
  portal). Extracting `ScreenAssignmentPanel` from `/settings/screens`
  is a self-contained follow-up.

## [main] 3-agent review fixes (9 red findings)

### Security — Electron
- `electron/main.ts` — `shell:openExternal` now parses via `new URL`, rejects
  non-http(s), rejects userinfo (blocks `https://legit@attacker.com`), and
  checks hostname against an allowlist (presentflow.app, app.presentflow.com,
  localhost, 127.0.0.1, plus first-party host + `NEXT_PUBLIC_APP_URL` host).
- `electron/main.ts` — `onBeforeSendHeaders` only injects `x-pf-shell` for
  first-party hosts (Next server + `NEXT_PUBLIC_APP_URL`). Third-party
  requests pass through unmodified. Listener registration is idempotent.
- `electron/ipc/fs.ts` — session-scoped path allowlist. `authorizePath` /
  `authorizeDir` populated only when the user picks via native dialog or
  drag-drop. `fs:readFile` and `fs:readDirRecursive` reject unauthorized
  paths — renderer JS can no longer trigger reads of arbitrary disk paths.
- `electron/ipc/dialog.ts` — calls `authorizePath` / `authorizeDir` for every
  path returned from `dialog.showOpenDialog`.

### Security — middleware
- `src/middleware.ts` — replaced bare `/api` desktop allowance with an
  explicit `DESKTOP_ALLOWED_API_PREFIXES` list. Blocked admin surfaces
  (announcements, archive, stripe on non-webhook paths, etc.) now return
  `{error:"not available in desktop shell"}` JSON 403 to a desktop shell.

### Fix — cross-tenant leak
- `src/app/(app)/dashboard/page.tsx:72` — the `aiSuggestions` query was
  `where(eq(aiSuggestions.servicePlanId, aiSuggestions.servicePlanId))`
  (tautology returning ALL suggestions across every church). Replaced with
  an inner-join on `servicePlans` filtered by `churchId`. Pre-existing bug
  from `49630a6`, affects both web and desktop.

### Operator UX
- `src/app/(app)/operator/page.tsx` — DB queries wrapped in try/catch;
  renders `OfflineState` client component with Retry + Diagnostics link.
- New `src/lib/dates.ts::getTodayInChurchTz` — `Intl.DateTimeFormat("en-CA",
  {timeZone})` -> `YYYY-MM-DD`. Operator page loads `churches.timezone` and
  uses it for `todayKey`.
- Multi-service same-day: since schema has no time-of-day column, pick the
  plan with the smallest id for determinism (see DECISIONS.md).
- `src/middleware.ts` — desktop-shell session expiry on `/operator` or
  `/services/*/operate` redirects to `/login?next=<path>&reason=session_expired`
  instead of stripping to `/login`.
- `src/app/login/page.tsx` — reads `next` (same-origin only) and shows a
  "You were signed out" hint when `reason=session_expired`.

## [main] Enforce desktop-shell (presenting) vs web-shell (admin) split

### Added

- `src/hooks/useShell.ts` — client-side `useShell()` returning `"desktop" | "web"`
  based on `window.electronAPI` + `pf_shell` cookie fallback.
- `src/app/(app)/operator/page.tsx` — desktop landing page. Redirects to today's
  scheduled service plan operator if one exists; otherwise renders a calm
  "ready to present" empty state with quick links.
- `desktopNav` in `src/components/layout/navigation.ts` — presenting-only nav
  groups (Content: Songs/Bible/Media/Imports/Themes, Learn: tutorial, playbook,
  projector/audio setup, diagnostics).
- Electron `shell:openExternal` IPC (in `electron/main.ts` + `preload.ts` +
  `src/types/electron.d.ts`) — used by the desktop sidebar's "Manage your
  church online" link to open the Vercel web portal in the default browser.
- Operator top-bar "Screens" button linking to `/settings/screens`.

### Changed

- `electron/main.ts` — sets `x-pf-shell: desktop` on every outbound request
  via `session.defaultSession.webRequest.onBeforeSendHeaders`, and appends
  `?ff_shell=desktop` to the initial `loadURL` so middleware can persist a
  `pf_shell=desktop` cookie for the session.
- `src/middleware.ts` — reads `x-pf-shell` header + `pf_shell` cookie; sets
  cookie from the `?ff_shell=desktop` query param; redirects any non-whitelisted
  authenticated route to `/operator` when in the desktop shell. Whitelist:
  `/operator`, `/services`, `/library`, `/setup`, `/tutorial`, `/help`,
  `/settings`, `/onboarding`, `/api`. Public and auth routes unchanged.
- `src/app/page.tsx` — server component reads shell markers; desktop → `/operator`,
  web → `/dashboard`.
- `src/app/login/page.tsx` — post-login redirect now goes to `/` so the root
  page routes to the correct shell landing.
- `src/app/(app)/dashboard/page.tsx` — belt-and-braces server-side redirect to
  `/operator` when the desktop shell is detected.
- `src/components/layout/Sidebar.tsx` — shell-aware. Renders `desktopNav` +
  a new `DesktopFooterPanel` (Settings link, "Manage your church online"
  external link, Sign out) on desktop. Web unchanged.
- `src/app/(app)/settings/page.tsx` — shell-scoped: desktop renders
  `SettingsForm` + Screens shortcut + `TranslationsPanel`. Web renders a
  compact grid of admin links (Billing, Team, Church Profile, Subscriptions).
- `src/components/operator/shell/TopToolbar.tsx` — added Screens button.

### Routes intact for web portal

No routes deleted. Admin surfaces (`/dashboard`, `/organization`, `/team`,
`/analytics`, `/archive`, `/subscriptions`, `/products`, `/applications`,
`/profile`, `/settings/organization`, `/settings/team`, `/settings/billing`)
still resolve on the web build.

### Manual verification checklist

1. `npm run electron:dev` in one shell → wait for "Ready in".
2. Launch Electron client. Sign in → should land on `/operator`.
3. `/operator` shows today's plan if scheduled, else empty state.
4. Sidebar shows only Content + Learn groups + Settings/Manage online/Sign out.
5. Type `/dashboard` into the Electron window — middleware bounces to `/operator`.
6. In parallel, open the Vercel-hosted web build in a browser → full admin
   sidebar; `/dashboard` renders normally.
7. In operator top bar, click **Screens** → opens `/settings/screens`.
8. Sidebar "Manage your church online →" opens the web portal in the OS
   default browser (Electron shell IPC), not inside the Electron window.
9. `curl -sI -H "x-pf-shell: desktop" http://localhost:3000/dashboard` behind
   an authenticated session cookie → 307 → `/operator`. Unauthenticated curl
   redirects to `/login` first (expected — auth check precedes shell check).

### Verified

- `npm run typecheck` — passes for source files. (Pre-existing `jsdom` types
  warning in `test/adversarial/audio-reconnect.test.ts` unchanged.)
- `npm run electron:build:tsc` — passes.

## [electron-shell] Import surfaces — Electron pickers + drag-drop

### Added

- `MediaUploader.tsx` (pptx + media): added `ElectronPickFilesButton`
  ("Choose from computer…") alongside the existing `<input type="file">`,
  plus a container-level drag-drop handler. Files from the Electron picker
  are reconstructed as `File` blobs (via base64 → Uint8Array) so the
  existing presign → PUT → register pipeline is untouched.
- `SongImporter.tsx`: added `ElectronPickFilesButton` (.txt/.csv/.pro) and
  drag-drop onto the textarea; imported content is appended with a `---`
  separator so multiple files can be batched.
- `WizardClient.tsx` (ProPresenter / EasyWorship / etc.): added
  `ElectronPickFilesButton` and `ElectronPickFolderButton`. The folder
  picker uses `electronAPI.fs.readDirRecursive` (filtered to
  `.pro6/.pro7/.pro7x/.pro5/.easypres/.xml`) and re-hydrates the results
  as `File` blobs with `webkitRelativePath` preserved so the server parser
  keeps its folder-relative source paths. Files can also be dropped
  directly onto the picker row.

### Not touched

- No sermon-specific import surface was found beyond the pptx path
  (already covered by `MediaUploader`).

## [electron-shell] Settings — system audio picker

### Added

- `SettingsForm.tsx`: prefers `window.electronAPI.audio.listInputs()` for
  device enumeration in Electron; falls back to `navigator.mediaDevices` in
  the browser build.
- `SettingsForm.tsx`: new "System Audio Sources" row (only rendered in
  Electron) listing entries from `electronAPI.audio.listSystemSources()`,
  with the BlackHole (macOS) / Windows-loopback note.

## [electron-shell] Rebrand

Global rename from **FaithFlow AI** to **Present Flow** as part of the Electron shell conversion.

### Changed

- Renamed **FaithFlow AI** → **Present Flow** (product name, user-facing)
- Renamed **FaithFlow** → **PresentFlow** (PascalCase / code identifiers)
- Renamed **faithflow-ai** → **presentflow** (kebab / slug — including `package.json` name field)
- Renamed **faithflow** → **presentflow** (lowercase / logs / string literals)
- Renamed **faith-flow** → **present-flow** (kebab variant)
- Renamed **faith_flow** → **present_flow** (snake variant)
- Renamed **FAITHFLOW** → **PRESENTFLOW** (uppercase / env var stems / constants)
- Replaced hardcoded `https://faithflow-ai.vercel.app` with placeholder `https://presentflow.app`
- 45 files updated across `src/**`, `docs/**`, `scripts/**`, `test/**`, root config files, `README.md`, `DEPLOY.md`

### Preserved (intentional — see DECISIONS.md)

- `fly.toml` app name (`faithflow-audio`) — bound to live Fly.io deployment
- `src/lib/db/schema.ts` `command_prefix` default (`"faithflow"`) — matches existing DB rows and command parser wake-word
- `scripts/seed-demo.ts` demo email (`demo@jpd.faithflow.ai`) — bound to live Supabase auth row for JPD demo

### Added

- `DECISIONS.md` — documents the three intentional exclusions and the placeholder-URL choice
- `CHANGELOG.md` — this file

## [electron-shell] STEP 2-5 — Electron shell scaffolding

### Added
- `electron/main.ts` — main process, lifecycle, tray, Next standalone server spawn on random free port
- `electron/preload.ts` — contextIsolated bridge exposing `window.electronAPI`
- `electron/tsconfig.json` — CJS output → `dist-electron/`
- `electron/ipc/screens.ts` — screens:list / assign / spawn / close
- `electron/ipc/audio.ts` — audio:listInputs (renderer strategy) / listSystemSources (desktopCapturer)
- `electron/ipc/dialog.ts` — openFile / openDirectory / showMessage
- `electron/ipc/fs.ts` — readDirRecursive / readFile (base64, 50MB cap)
- `electron/windows/OutputWindow.ts` — role-keyed fullscreen frameless output windows
- `src/types/electron.d.ts` — window.electronAPI type declarations
- `src/app/(app)/settings/screens/page.tsx` — Screen Configuration UI, per-display role/preset assignment, spawn/close, auto-restore toggle (localStorage)
- `src/components/electron/ElectronFilePickers.tsx` — reusable Electron file/folder picker components (render null in browser)
- `BUILD.md` — dev/build/smoke-test docs

### Changed
- `next.config.ts` — `output: "standalone"` so electron-builder can bundle the server
- `package.json` — `"main": "dist-electron/main.js"`; added electron:dev / electron:build:tsc / electron:build / electron:build:win / electron:preview scripts; added `build` block for electron-builder
- `.gitignore` — exclude `dist-electron/` and `release/`
- `src/components/setup/ProjectorSetupWizard.tsx` — projector opener uses `electronAPI.screens.spawn('Projector')` when in Electron; added link to `/settings/screens`
- `src/components/operator/OperatorConsole.tsx` — output window opener routes through Electron IPC when available; browser popup fallback preserved

### Notes
- `electron:build:tsc` passes clean; `next build` produces `.next/standalone/`
- Media permissions pre-approved in main process (no getUserMedia prompt inside Electron)

## ProOperatorShell reviewer + security sweep (2026-07-12)

Closed 6 🔴 and 14 🟡 findings from the ProOperatorShell review.

### 🔴
- **R1** zone widths: LEFT `w-40` (160px), RIGHT `w-[300px]` (was 180/320)
- **R2** right-click Delete now dispatches `onDeleteSlide(itemIdx, slideIdx)` with explicit indices; synthetic keydown bridge removed
- **R3** shell-aware render: desktop → `ProOperatorShell`, web → `OperatorShell` (via `useShell()`); dead `void OperatorShell` removed
- **R4** Timer & Messages tab state lifted to `ProOperatorShell` via `useTimerSession()` / `useMessagesSession()` — ticks survive Tabs unmount
- **R5** Bible session state (`ref/translation/mode/cards/selectedIdx/loading`) lifted via `useBibleSession()` — center-mode toggle no longer wipes results
- **R6** CenterHeader title is read-only with "Rename coming soon" tooltip/toast (no `renameServiceItem` action exists yet)

### 🟡
- **Y1** Bible options key renamed `presentflow.bibleOptions.v1` → `presentflow.pro.bible.v1`; `showVerseNumbers` + `refFormat` now consumed by BibleMode; local `refFmt` select removed
- **Y2** OutputState effect skips emission when packed state unchanged (JSON signature)
- **Y3** dead `aiBadge` state removed from SlideCard
- **Y4** CenterHeader input carries `key={item?.id}`; controlled read-only value
- **Y5** CenterHeader Play button reads Safe Mode from the same localStorage key SlideGrid uses
- **Y6** `shellCtx` wrapped in `useMemo` with explicit deps; consumers no longer re-render on unrelated ticks
- **Y7** Bible verse-mode = 1 verse/card; passage-mode = up to 4 verses/card
- **Y8** LivePreviewPanel: destructive 2px border + LIVE badge when live
- **Y9** slide-thumb CSS var removed; `slideSize` prop is single source of truth
- **Y10** SlideGrid `role=grid`/`gridcell` + `tabIndex` + `focus-visible` ring
- **Y11** ThemesTab swatches documented as intentional demo theme previews
- **Y12** covered by R3 (dead import removed)
- **Y13** `/api/bible/lookup` per-user rate limit 60/min via `createLimiter`
- **Y14** `book` param rejected if not string / length>64 / contains control chars

### Files changed
- `src/components/operator/pro/ProOperatorShell.tsx` — zones, hooks wiring, removed CSS var
- `src/components/operator/pro/hooks.ts` — new: `useTimerSession`, `useMessagesSession`, `useBibleSession`
- `src/components/operator/pro/center/SlideGrid.tsx` — direct `onDeleteSlide`, a11y, aiBadge dropped
- `src/components/operator/pro/center/BibleMode.tsx` — reads lifted session + BibleOptions
- `src/components/operator/pro/center/BibleOptionsPopover.tsx` — namespace key
- `src/components/operator/pro/center/CenterHeader.tsx` — read-only, Safe-Mode-aware Play
- `src/components/operator/pro/right/LivePreviewPanel.tsx` — LIVE border + badge
- `src/components/operator/pro/right/RightTabs.tsx` — accepts `timer`/`messages` APIs
- `src/components/operator/pro/right/tabs/TimersTab.tsx` — consumes shell-lifted API
- `src/components/operator/pro/right/tabs/MessagesTab.tsx` — consumes shell-lifted API
- `src/components/operator/pro/right/tabs/ThemesTab.tsx` — swatch comment
- `src/components/operator/OperatorConsole.tsx` — shell-aware render, memoized `shellCtx`, OutputState dedup, `onDeleteSlide`
- `src/components/operator/shell/types.ts` — added optional `onDeleteSlide`
- `src/app/api/bible/lookup/route.ts` — rate limit + book input validation

## [main] Priority 9 — tutorial + playbook + diagnostics (2026-07-12)

### Diagnostics (real signals)
- Added 3 new checks to `DiagnosticsPanel`: audio input device count (`navigator.mediaDevices.enumerateDevices`), Electron displays (`electronAPI.screens.list()`), Deepgram key presence.
- Added Refresh button — re-runs every check without reload.
- Kept existing real checks: app, db, storage, audio bridge WS handshake, Groq helpers, Supabase realtime.

### API endpoints
- `src/app/api/health/deepgram/route.ts` — auth-gated presence check for `DEEPGRAM_API_KEY`. Never returns the key value.
- `src/app/api/health/db/route.ts` — already existed; auth-gated `SELECT 1`.

### Guided tour overlay
- `src/components/tutorial/OperatorTour.tsx` — 5-step spotlight tour of ProOperatorShell zones (left / center / right / bottom / top). SVG-mask cutout, keyboard nav (Arrow/Enter/Esc), no external dep.
- `data-tour` attributes added to the five shell zones.
- ProOperatorShell listens for IPC `shell:open-tour`; auto-opens once when `localStorage.presentflow.tour.seen != "1"`.
- Electron Help > Guided Tutorial swapped from external URL to IPC (mirrors Keyboard Shortcuts pattern).

### First Sunday + setup guides
- `src/app/(app)/help/first-sunday/page.tsx` — verified: 255 LOC, before/preflight/practice/during/recovery/after sections. No changes.
- `/setup/projector`, `/setup/audio`, `/setup/diagnostics` — verified as `requireUser()`-gated pages backed by wizard/panel components. No content changes needed.

## 2026-07-12 — P10 tier reviewer/security fixes

- **fix(tier)**: pilot tier now gets early-access Max preview across all three gated surfaces (Bible options, Themes tab, ProContent popover). `canAccess` updated in `src/lib/tier.ts`.
- **fix(tier)**: `useTier` in-memory cache now has 60s TTL, refetches on window focus + visibilitychange + cross-tab `presentflow.tier.invalidate` storage event, exposes `refresh()` and `invalidateTierAcrossTabs()`. Last-known-good tier is preserved on 503 to avoid mid-service flash of upgrade prompt.
- **fix(api/tier)**: DB error now returns `503 { tier: null, error: "unavailable" }` instead of fail-open `"free"`.
- **chore(tier)**: `src/lib/tier.ts` marked `@client-only`; added `dbTierToPlanLabel()` (analytics-safe raw label); added TODO for starter SKU distinction.
- **chore(tier)**: `MaxUpgradePrompt` validates `NEXT_PUBLIC_APP_URL` (must be `https:`) before use; falls back to `https://presentflow.app`.
- **chore(auth)**: `_resetTierCache()` wired into Topbar + Sidebar sign-out handlers.
- **test(tier)**: 21 → 42 assertions. Added pilot early-access invariants, unknown-feature falls-open per tier, `isMaxOnly` case-sensitivity assertions, `dbTierToPlanLabel` cases, and `FEATURE_BLURB` ↔ `MAX_FEATURES` drift guard.

## 2026-07-12 — UI polish pass (PP-parity, Tasks 1–3)

### feat(operator/pro/topbar): cleaner PP-parity toolbar with dividers
- `src/components/operator/pro/TopBar.tsx` — 34×34 hit area, 18px
  icon, 4px gap; vertical 1px `--color-border` divider between
  action cluster (Search/Text/Theme) and content cluster
  (Show/Edit/Reflow/Bible). Removed `Arrangement` icon; collapsed
  into More menu. Tooltip + label use `--font-display`. Added Bible
  IconBtn shortcut that toggles bible center mode.

### feat(operator/pro/center): slide-size slider in center header
- `src/components/operator/pro/center/CenterHeader.tsx` — accepts
  optional `slideSize`/`onSlideSize` props; renders a 150px
  horizontal slider (accent `#5b9bd5`) in the right of the header
  when `centerMode === "slides"`.
- `src/components/operator/pro/ProOperatorShell.tsx` — plumbs the
  same `slideSize` state that already backs SlideGrid into
  CenterHeader; drops the prop from BottomBar.
- `src/components/operator/pro/BottomBar.tsx` — removed the
  duplicate slider and its two props; simpler signature.

### feat(operator/pro/bottom): transition duration inline slider
- `src/components/operator/pro/BottomBar.tsx` — inline range input
  (0.0–5.0s, step 0.1) beside the transition popover trigger.
  Persists via the existing `presentflow.pro.transition.v1` key
  (already extended to `{ name, duration }` in a prior pass).
  Broadcast wiring deferred — see DECISIONS.md.

### Tasks deferred (see DECISIONS.md)
- Task 4 (Themes dialogs), Task 5 (right-sidebar output indicators),
  Task 6 (transition chooser tabs), Task 7 (Bible phrase search UI —
  endpoint already exists at `/api/bible/search`).

## Voice commands + Audio input + Auto-pause + Bible Store real state

### feat(voice-commands): runtime wiring
- `src/lib/voice-commands.ts` — new module. `matchCustomCommand`
  (whole-word, case-insensitive, 5s per-action debounce, longest
  wins), `readCustomCommands`, `readAudioInputPref`,
  `audioConstraintsFor`. Pure functions so tests can drive them.
- `src/components/operator/useAudioStream.ts` — after every final
  transcript, match against `presentflow.pro.voiceCommands.v1` and
  dispatch `presentflow:voice-command` with `{action, phrase}`.
- `src/components/operator/pro/ProOperatorShell.tsx` — listens for
  the event and routes to `hotkey-next` / `hotkey-prev` /
  `switch-translation` (NIV) / `ctx.onBlank` / `ctx.onKill`. Toasts
  "Voice command: <phrase>" so operator sees it fired.

### feat(ai-pipeline): honour audio-input preference; restart on change
- `useAudioStream` reads `presentflow.pro.audioInput.v1` before
  `getUserMedia`, passes `deviceId: { exact }` for `kind: "device"`,
  logs the documented NDI fallback line for `kind: "ndi"`.
- Restarts the pipeline on `presentflow:audio-input-changed`.
- `AudioTab` dispatches that event on every selection change.

### feat(operator/pro): recent detections + 10-min auto-pause
- New `RecentDetectionsPanel` under `LivePreviewPanel` in the right
  sidebar. Last 5 unified suggestions. Empty state text and
  formatting per spec.
- `useAudioStream` tracks `lastTranscriptAtRef` (interim + final);
  30s poll checks silence; after 10 min while `receiving_final`,
  tears down the pipeline and transitions stage to new `paused`
  value. Closes the WS to avoid Deepgram cost.
- `resume()` exposed from the hook, plumbed via
  `OperatorShellCtx.onResumeAudio`. Orange Resume button in the
  panel shows only when paused.
- Auto-pause toggle in Settings > Audio; localStorage
  `presentflow.pro.autoPause.enabled` (default on).

### feat(bible-store): reflect real DB state
- New endpoint `GET /api/bible/translations/status` — `apiUser`-gated,
  returns per-translation `{code, name, licenseRequired, books,
  downloaded, partial}`. Licensed translations report 0 books (matches
  the server-side `isLicensedTranslation` guard). Single roundtrip;
  church-scoped read via the same DB session used elsewhere.
- `BibleStoreTab` fetches on mount. Renders "Downloaded" when
  `books >= 66`, "Partial (X/66 books)" when 0 < books < 66, or a
  "Download" button otherwise. Paid rows (AMP, AMPC, ASV, HCSB, TPT)
  still render as Paid + Upgrade regardless of DB state.

### test
- `test/voice-commands.test.ts` — 6 new tests covering empty list,
  case-insensitivity, whole-word rule, 5s debounce (before/after),
  and longest-phrase-wins.
- `test/ai-pipeline.test.ts` — 7 new tests for `readAudioInputPref`
  (null / valid / malformed / invalid kind) and `audioConstraintsFor`
  (device / NDI / null). Existing PipelineStage test updated to
  include `paused`.
