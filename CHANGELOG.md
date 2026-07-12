# Changelog

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
