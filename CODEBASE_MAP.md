# PresentFlow — Codebase Map

> Reference doc for prompts (marketing, design-system, onboarding). Generated 2026-07-27 against v0.1.102.
> One repo, two surfaces: **web admin** (Next.js on Vercel) + **desktop operator** (thin-client Electron shell that loads the hosted URL).

## 1. Project overview

- **What**: AI-native church presentation software (rebrand of FaithFlow AI). Live speech → Deepgram transcription → Bible-reference / song / voice-command detection → auto-projects slides.
- **Surfaces**: (1) Web admin — planning, library, billing, team, onboarding. (2) Electron desktop — the operator console + projector/stage output windows + native pro-audio capture. Desktop-first: operator/AI/live features target the shell.
- **Deploy**: Next.js → Vercel (`faithflow-ai.vercel.app`, push to main). Audio WS bridge → Fly.io (`./scripts/deploy.sh audio`). Desktop → unsigned .dmg via GitHub Releases (`./scripts/release.sh vX.Y.Z`, auto-update via electron-updater). DB/storage → Supabase (Postgres + pgvector + S3-compatible).
- **Stack**: Next.js App Router, Drizzle ORM, NextAuth (JWT), Tailwind v4 (CSS-first config), Radix UI, lucide-react, dnd-kit, Deepgram v5, Groq (llama-3.3-70b), Stripe, Sentry.
- **Version**: `package.json` 0.1.102. What's New modal reads `src/lib/changelog.ts` — every sizable change ships a changelog entry (house rule).

## 2. Route map (`src/app/`)

Auth: everything is auth-required EXCEPT the public paths in `src/middleware.ts` (`/login /signup /verify-email /forgot-password /reset-password /accept-invite`, `/api/auth|health|stripe|cron|internal`). `/live /stage /livestream` require auth (locked down in security pass Y10; Electron output windows share operator cookies).

### Output surfaces (fullscreen render targets, OUTSIDE `(app)` group — no sidebar chrome)

| Route | File | Purpose |
|---|---|---|
| `/live` | `src/app/live/page.tsx` | Projector output. Listens to BroadcastChannel (same machine) + Supabase Realtime pair-code channel; renders SlideRenderer + AnnouncementLayer + TransitionWrapper |
| `/stage` | `src/app/stage/page.tsx` | Stage/confidence monitor (lyrics + next slide + clock for on-platform talent) |
| `/livestream` | `src/app/livestream/page.tsx` | Livestream/OBS overlay output (lower-third style for stream capture) |

### Operator surfaces

| Route | File | Purpose |
|---|---|---|
| `/operator` | `(app)/operator/page.tsx` | Desktop landing. ALWAYS renders OperatorConsole — loads today's plan (church tz) or synthesizes an ephemeral empty plan |
| `/services/[id]/operate` | `services/[id]/operate/page.tsx` | Per-plan deep-link operator console (outside `(app)`, visually identical to `/operator`) |
| `/practice` | `(app)/practice/page.tsx` | Practice Mode sandbox — scripted transcript rehearsal, nothing reaches projector/DB |

### Admin / web app (`(app)` route group — Sidebar + Topbar via `AppShell`)

| Route | Purpose |
|---|---|
| `/dashboard` | Admin home: cards, recent updates, next service |
| `/services`, `/services/new`, `/services/[id]` | Service plan list / create / playlist editor |
| `/library/songs`, `/library/songs/[id]` | Song library table; per-song slide editor (SongSlideEditor) |
| `/library/bible`, `/library/bible/licensed` | Bible translations browser; licensed (API.Bible etc.) connections |
| `/library/media` | Image/video assets (S3 upload via presign) |
| `/library/imports`, `.../[id]`, `.../wizard` | PPTX sermon-deck imports + migration wizard (ProPresenter/EasyWorship/…) |
| `/library/themes` | Slide THEME manager (product feature — see §7) |
| `/archive`, `/archive/[id]` | Sermon archive: AI summaries, transcripts, Ask-the-sermon RAG search |
| `/analytics` | Church usage/service analytics |
| `/applications` | Admin-only "products in use" overview (song/media/licensed/archive counts) |
| `/products`, `/subscriptions` | Plan/tier marketing + subscription management |
| `/organization` | Church profile, branding, worship defaults |
| `/profile` | Personal account settings |
| `/settings` + `/settings/{billing,devices,download,outputs,screens,team}` | Settings tabs: Stripe billing, paired devices, desktop download, output config, screen assignment, team+invites |
| `/setup/{audio,projector,diagnostics}` | Guided wizards: audio capture, projector output, diagnostics panel |
| `/tutorial`, `/help/first-sunday` | Guided tour; "your first Sunday" help doc |
| `/upgrade/{starter,pro,church}` | Tier upgrade funnels |

### Auth + onboarding (public or semi-public)

| Route | Purpose |
|---|---|
| `/` | Entry — redirects by auth/shell state |
| `/login`, `/signup` | Credentials auth (AuthShell split-panel with animated brand mesh) |
| `/verify`, `/verify-email` | Email verification (two paths, same action — `/verify` is canonical mirror) |
| `/forgot-password`, `/reset-password` | Password reset flow (sha256-hashed tokens in `auth_tokens`) |
| `/accept-invite` | Team invitation acceptance |
| `/onboarding` + `/{church,migration,download,tutorial}` | Wizard: church details → migrate library → download desktop → tutorial |

## 3. API surface (`src/app/api/`)

| Path | Method | Purpose |
|---|---|---|
| `/api/auth/[...nextauth]` | * | NextAuth credentials handler |
| `/api/auth/device-exchange` | GET | Deep-link token → session (desktop `presentflow://auth` login handoff) |
| `/api/me` | GET | Current user/church snapshot |
| `/api/tier` | GET | Subscription tier for client gating (`useTier`) |
| `/api/usage` | GET | Song/storage usage vs tier limits |
| `/api/audio/ticket` | POST | Mint signed HMAC ticket for the Fly WS bridge (Deepgram key never leaves server) |
| `/api/audio/session-metrics` | POST | Persist per-listening-session metrics → `audio_sessions` (dedupe by client sessionId) |
| `/api/bible/{books,chapter,chapters,translations,translations/status}` | GET | Bible library reads (global, NOT church-scoped by design — documented exception) |
| `/api/bible/{lookup,search}` | POST | Reference lookup; phrase/semantic verse search |
| `/api/songs/{list,library}` | GET | Church songs; built-in hymn library |
| `/api/songs/[id]/slides` | GET | Slides for one song |
| `/api/songs/public-domain/search` | GET | Public-domain hymn search |
| `/api/media/list` / `/api/media/presign` | GET/POST | Media assets; S3 presigned upload URLs |
| `/api/imports/{list,parse}` | GET/POST | Migration jobs; parse uploaded library exports |
| `/api/pptx/convert` | POST | PPTX → slide images + text extraction pipeline |
| `/api/themes` | GET | Church slide themes |
| `/api/announcements/presets` | GET | Announcement presets |
| `/api/ai/helpers/[action]` | POST | Groq-backed AI helpers (rewrites, suggestions; action-dispatched) |
| `/api/ai/lookup-song-metadata` | POST | Internet-assisted song metadata lookup |
| `/api/sermon/match` | POST | Transcript ↔ sermon-deck slide matching (pgvector) |
| `/api/sermon/ask` | POST | Ask-the-sermon RAG over `sermon_chunks` |
| `/api/sermon/backfill` | POST | Admin: paste past transcript → chunk + embed |
| `/api/autopilot/history` | GET | AI suggestion audit trail |
| `/api/search` | GET | Global search (SearchPalette backend) |
| `/api/archive/[id]/export` | GET | Export sermon archive entry |
| `/api/feedback` | POST | Bug/feature feedback → `feedback` table |
| `/api/internal/semantic-search` | POST | Bearer-secret endpoint for the Fly bridge (embeddings live on Vercel, not Fly) |
| `/api/cron/{warm-embeddings,backfill-sermons}` | GET | Vercel cron: warm embedding model; drain un-chunked transcripts |
| `/api/stripe/webhook` | POST | Stripe events (idempotent bundle crediting) |
| `/api/health` + `/{db,ai,deepgram,storage}` | GET | Health probes per dependency |

### Server actions

`src/lib/actions.ts` — ALL auth-gated + church-scoped (house rule; only Bible library is global). By cluster:

| Cluster | Actions |
|---|---|
| Service plans | `createServicePlan`, `deleteServicePlan`, `cleanupAdHocServicePlans`, `addServiceItem`, `addServiceItems`, `removeServiceItem`, `reorderServiceItems`, `reorderItemSlides` |
| Songs + slides | `createSong`, `deleteSong`, `updateSongSlides`, `updateSongSettings`, `saveSlideObjects`, `createSongSlide`, `deleteSongSlide`, `duplicateSongSlide`, `reorderSongSlides` |
| Imports | `importPro6Files`, `importSongsCsv`, `importPublicDomainSong`, `addBuiltInHymnsToMyChurch` |
| Media / PPTX | `registerMediaAsset`, `deleteMediaAsset`, `renameMediaAsset`, `createPptxImport`, `deletePptxImport` |
| AI/autopilot | `updateDetectionStatus`, `updateAiSuggestionStatus`, `editAiSuggestion` |
| Sermon archive | `generateSermonSummaryAction`, `upsertSermonMetadata`, `scaffoldSermonArchive` |
| Announcements | `createAnnouncement`, `updateAnnouncement`, `deleteAnnouncement`, `saveAnnouncementPreset`, `deleteAnnouncementPreset` |
| Themes (slides) | `createTheme`, `updateTheme`, `duplicateTheme`, `deleteTheme`, `reorderThemes`, `setDefaultTheme`, `exportTheme`, `importTheme`, `applyThemeToSong` |
| Church/settings | `updateSettings`, `updatePreferences`, `updateChurch`, `updateChurchKeyterms` |

`src/lib/import-actions.ts`: `importDrop` (upload a library export → migration job), `finalizeImport` (commit parsed songs). Both church-scoped.

Other action files: `auth-actions.ts` (signup/verify/reset), `billing-actions.ts` (Stripe checkout/portal), `device-link-actions.ts` + `device-pair-actions.ts` (desktop login link, projector pair codes), `invitation-actions.ts`, `onboarding-actions.ts`, `tutorial-actions.ts`, `sign-out.ts`.

## 4. Component inventory (`src/components/`)

### Layout (web admin chrome)
| File | Renders |
|---|---|
| `layout/AppShell.tsx` | `(app)` wrapper: Sidebar + Topbar + content |
| `layout/Sidebar.tsx` / `navigation.ts` | Admin nav (collapsible; nav registry in navigation.ts) |
| `layout/Topbar.tsx`, `layout/PageHeader.tsx` | Top chrome; eyebrow/title/description page header |
| `layout/RealtimeSyncBridge.tsx`, `SyncIndicator.tsx` | Supabase Realtime wiring + sync status dot |

### Operator console — pro shell (THE heart)

`OperatorConsole.tsx` (~owner of ALL state/handlers, builds `OperatorShellCtx` prop bag) → renders **`pro/ProOperatorShell.tsx`** (3,064 lines: zone composition + auto-fire policy — `SONG_AUTOLIVE_CONFIDENCE` 70%, anti-replay maps, AUTO/MANUAL gating; see CLAUDE.md rule 7).

Layout zones: `TopBar` (44px) / Left ~160px / Center / Right ~300px / `BottomBar` (40px) / `MediaStrip` (140px, collapsible).

| Zone | Files | Renders |
|---|---|---|
| Top | `pro/TopBar.tsx` | Plan title, AI listen pill, clock, output toggles, settings gear |
| Left | `pro/left/PlaylistSection.tsx` | Service playlist (dnd-kit reorder, live-item highlight) |
| | `pro/left/LibrarySection.tsx` | Song library quick-add |
| | `pro/left/MediaSection.tsx` | Media quick-access |
| | `pro/left/HardwarePanel.tsx` | Audio device / capture-tier status |
| Center | `pro/center/CenterHeader.tsx` | Mode switcher (slides/bible/songs/media) + breadcrumbs |
| | `pro/center/SlideGrid.tsx` | Slide thumbnails for current item; click → live |
| | `pro/center/BibleMode.tsx` + `BibleBookBrowser`, `BibleOptionsPopover` | Reference lookup + 66-book browse |
| | `pro/center/SongsBrowser.tsx`, `MediaBrowser.tsx` | Inline library browsers |
| Right | `pro/right/LivePreviewPanel.tsx` | Live + preview output thumbnails |
| | `pro/right/OutputRoutingRow.tsx` | Per-output (projector/stage/stream) routing toggles |
| | `pro/right/RightIconBar.tsx` | Icon rail → popover tabs (replaced RightTabs.tsx, which is still in tree, unused) |
| | `pro/right/AIDetectionsPanel.tsx` | AI suggestion chips/cards (approve/reject/edit) |
| | `pro/right/tabs/{AudioTab,MacrosTab,MessagesTab,StageTab,ThemesTab,TimersTab}.tsx` | Audio meters, macros, stage messages, stage display config, live theme pick, countdown timers |
| Bottom | `pro/BottomBar.tsx` + `BottomBar/TransitionChooser.tsx` | Transport: clear/blank/logo, transition picker |
| | `pro/MediaStrip.tsx` | Filmstrip of media for quick fire |
| Overlays | `pro/SearchPalette.tsx` | Cmd+K global search (songs/verses/media/actions) |
| | `pro/ShortcutsHelpOverlay.tsx`, `AICaptionsBanner.tsx`, `UpdateBanner.tsx` | ?-key shortcuts, live captions banner, auto-update prompt |
| Hooks | `pro/hooks.ts` (`useTimerSession`, `useMessagesSession`, `useBibleSession`), `useDebouncedInterim.ts` | Session-scoped feature state |

### Operator — supporting
| File | Purpose |
|---|---|
| `operator/useAudioStream.ts` | 2,623-line audio+detection pipeline hook (see §6) |
| `operator/useVerseBank.ts` | Session verse history bank |
| `operator/settings/SettingsModal.tsx` + `tabs/{Audio,BibleStore,Display,Feedback,Help,Language,License,Usage}Tab.tsx` | In-console settings modal (desktop's settings surface) |
| `operator/editor/{SlideCanvas,SlideEditorContext,useSlideEditor,CanvasWarnings}` | Rich slide object editor (objectsJson model) |
| `operator/workspace/{BibleBrowserMode,MediaBinMode,SermonDeckMode,SermonFollowPanel,SongReflowMode}` | Center workspace modes incl. AI sermon-deck follow |
| `operator/screens/ScreensPanel.tsx` | Electron display assignment |
| `operator/{AudioSetupModal,VocalChannelAutoDetectModal,AudioDiagnosticsScan}` | Audio onboarding + channel auto-detect |
| `operator/{AIAssistantPanel,AIHelpersPanel,AIDiagnosticModal,SuggestionHistory,EditSuggestionModal,SimulatePhraseInput}` | AI panels, history, dev simulation |
| `operator/{WhatsNewModal,EndServiceButton,SyncControl,LiveOutputThumb,SlideContextMenu,ImportSongModal,OperatorErrorBoundary}` | Misc console chrome |
| `operator/shell/{TopToolbar,LeftColumn,CenterWorkspace,RightInspector,BottomDrawer,ActionBar}` + `OperatorShell.tsx`, `RailWorkspaceShells.tsx`, `WorkspaceTabs.tsx`, `OutputStack.tsx`, `ProductionRail.tsx`, `BottomTray.tsx` | LEGACY shell generation (pre-"pro"); `shell/types.ts` still owns `OperatorShellCtx` |
| `operator/dev/AudioDebugOverlay.tsx` | Dev overlay (levels, WS state, detection trace) |

### Live output
`live/SlideRenderer.tsx` (canonical slide render: lyrics/scripture/media/objectsJson + theme), `live/AutoFitText.tsx` (binary-search font fit), `live/AnnouncementLayer.tsx` (lower-third/ticker/banner), `live/TransitionWrapper.tsx` (cut/fade/slide transitions).

### Feature / shared
| Area | Files |
|---|---|
| Library | `library/{SongsTable,SongSlideEditor,SongImporter,SongBundlesPanel,SongLicensingPanel,InternetSongDetectionPanel,BibleBrowser,BiblePanel,BibleTranslationGrid,BibleTranslationsSimple,MediaCard,MediaUploader,ImportsGrid,PptxRetryButton,PptxDeleteButton,SermonMetadataForm,ThemesManager}` |
| Services | `services/{PlaylistEditor,ServicePlanRow,GenerateSummaryButton,CleanupAdHocButton}` |
| Settings | `settings/{SettingsForm,TeamManager,BillingPanel,DevicesList,DesktopDownloadPanel,TranslationsPanel}` |
| Setup | `setup/{AudioSetupWizard,ProjectorSetupWizard,DiagnosticsPanel}` |
| Onboarding | `onboarding/{OnboardingWizard,OnboardingSplash,ChurchDetailsForm,MigrationStep,OnboardingMigrationClient,OnboardingTutorialClient,GatedTutorial}` |
| Tutorial | `tutorial/{GuidedTour,OperatorTour,TourGate}` |
| Misc | `auth/AuthShell`, `brand/ChurchLogoAvatar`, `organization/{ChurchProfileForm,ChurchBrandingUploader,WorshipDefaultsForm}`, `archive/{ArchiveSearchBar,AskSermonHistory}`, `dashboard/{DashboardCard,RecentUpdatesPanel}`, `ai/UnifiedSuggestionCard`, `account/AccountCard`, `tier/MaxUpgradePrompt`, `electron/ElectronFilePickers` |
| ui/ (shadcn-style primitives) | `button, card, input, tooltip, theme-toggle` (only 5 — most UI is bespoke Tailwind) |

## 5. Data layer

### Drizzle schema (`src/lib/db/schema.ts`) — church_id scoping is a hard rule

| Table | Purpose | Church-scoped |
|---|---|---|
| `churches` | Tenant root (name, tz, denomination, isDemo flag) | root |
| `users` | Auth users; role enum admin/operator/volunteer/pastor/viewer | yes (nullable pre-onboarding) |
| `auth_tokens`, `invitations` | Verify/reset tokens; team invites | via user / yes |
| `subscriptions`, `song_bundle_purchases` | Billing (tier pilot/starter/pro/enterprise); append-only bundle ledger (Stripe-idempotent) | yes |
| `migration_jobs` | Bulk import tracking (ProPresenter/EasyWorship/Proclaim/CSV) | yes |
| `service_plans`, `service_items` | Service + ordered playlist items (typed payload jsonb) | yes / via plan |
| `songs`, `song_slides` | Songs (+settings jsonb); slides w/ legacy `lyrics` OR rich `objectsJson` | yes / via song |
| `media_assets` | S3-backed images/videos | yes |
| `pptx_imports`, `pptx_slides`, `sermon_metadata` | Sermon decks: slide images + extracted text + 384-dim embeddings (hnsw) | yes |
| `settings`, `church_preferences` | Blank/logo/font; AI thresholds, autopilot toggles, default translation, retention | yes (1:1) |
| `bible_translations`, `bible_verses` | GLOBAL Bible library (embedded, hnsw) — the documented scoping exception | NO |
| `licensed_translations` | Per-church licensed Bible API connections | yes |
| `transcript_segments`, `detected_references` | Live transcript + rule-parsed scripture hits | via plan |
| `ai_suggestions` | Unified suggestion audit (auto/manual/edited/rejected + resolver) | via plan |
| `sermon_summaries`, `sermon_chunks` | Per-service AI summary (embedded); chunk-level RAG (churchId denormalized) | via plan / yes |
| `church_service_patterns` | Aggregated per-church patterns (top songs/scriptures) | yes (1:1) |
| `announcements`, `announcement_presets`, `themes` | Overlay announcements; slide themes (config jsonb, isDefault, sortOrder) | yes |
| `device_pairs` | Short-lived pair codes authorising projector/stage/stream Realtime subscriptions | yes |
| `feedback`, `audio_sessions`, `church_learned_keyterms` | In-app feedback; listening-session metrics; learned Deepgram keyterm bias | yes |

### State management
- **No Zustand/Redux.** State lives in `OperatorConsole.tsx` (giant hook-state owner) passed via the `OperatorShellCtx` prop bag (`operator/shell/types.ts`).
- React contexts: `operator/editor/SlideEditorContext.tsx` (slide editor), `pro/center/BibleOptionsPopover.tsx` (local).
- Cross-window: `src/lib/broadcast.ts` (BroadcastChannel — PRIMARY same-machine sync), `src/lib/realtime.ts` (Supabase Realtime — cross-device fan-out via pair codes), `src/lib/internal-events.ts` (window CustomEvents).
- Session persistence: `src/lib/operatorSessionState.ts` (+ heavy localStorage/sessionStorage use, below).

### localStorage registry (~75 unique `presentflow.*` keys — grep found far more than the expected 25)

| Group | Keys | Stores / read by |
|---|---|---|
| Audio input | `pro.audioInput.v1`, `pro.audioInputNative.v1`, `pro.audioSourceType.v1`, `pro.audioCaptureMode.v1`, `pro.deviceChannelPrefs.v1`, `pro.micBoost.v1`, `pro.micHighpass.v1` | Device/channel/mode prefs → `useAudioStream`, audio libs, AudioTab |
| AI behavior | `pro.autoApprove.v1`, `pro.holdAutoApproveDuringSong.v1`, `pro.autoPause.enabled`, `pro.aiAlwaysOn`, `pro.aiListenIntent.v1`, `pro.autoFireMinGap.v1`, `autopilot.mode`, `pro.transcriptionMode.v1` | Autopilot toggles → ProOperatorShell / useAudioStream |
| AI session (sessionStorage) | `pro.autoFired.v1`, `pro.songAutoFired.v1` | Anti-replay fired-reference maps |
| Voice/vocab | `pro.voiceCommands.v1`, `pro.voiceCommandsEnabled.v1`, `pro.customVocabulary.v1` | Custom commands + Deepgram vocab |
| Bible | `pro.bible.v1`, `pro.bibleLang.v1`, `biblePanel.{view,refFormat,cardSize}` | Bible mode prefs |
| Output/display | `screenAssignments.v1`, `screenAssignments.autoRestore`, `pro.defaultOutput.v1`, `pro.previewDisplay`, `pro.defaultAspect.v1`, `pro.safeArea.v1`, `stage.resolution`, `pro.showRoutingRow` | Display routing → ScreensPanel, outputs |
| Transitions | `pro.transition.v1`, `pro.transition`, `pro.transitions.favorites.v1` | TransitionChooser |
| UI layout | `sidebar.collapsed`, `rail.collapsed`, `drawer.expanded`, `inspector.tab`, `center.slideSize`, `pro.slideSize`, `pro.mediaStripOpen`, `operator.slideViewMode`, `pro.settings.tab.v1`, `pro.uiLang.v1` | Panel/layout persistence |
| Features | `pro.timer.v1`, `pro.messages.v1`, `pro.macros.v1`, `pro.blankSlides.v1`, `pro.customThemes.v1`, `song.template.*`, `sermonFollow.disabled.*` | Timers, stage messages, macros, themes cache |
| Session/sync | `pro.sessionState.v1`, `sync.pairCode`, `sync.pairExpiresAt`, `metrics.retryQueue.v1`, `internal-nonce.v1` | Resume + pairing + metric retry |
| App/meta | `whatsNew.lastSeenVersion`, `tour.seen`, `tier.invalidate`, `safeMode`, `operator.safeMode`, `aiTrace`, `debugOverlay`, `pro.licenseKey.v1`, `pro.churchName.v1` | Modals, tours, safe-mode, debug gates |

### Env vars (names only)
`AUTH_SECRET, DATABASE_URL, DEEPGRAM_API_KEY, GROQ_API_KEY, GROQ_MODEL, XAI_API_KEY, XAI_BASE_URL, XAI_MODEL, RESEND_API_KEY, EMAIL_FROM, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, S3_BUCKET, S3_ENDPOINT, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_AUDIO_WS_URL, AUDIO_WS_PORT, AUDIO_WS_PER_USER_CAP, AUDIO_WS_RATE_LIMIT, INTERNAL_API_BASE, INTERNAL_API_SECRET, CRON_SECRET, PF_APP_URL, PF_CONFIG_DIR, PF_BIBLE_CACHE_LOG, PRESENTFLOW_DEV_PORT, BASE_URL, EXTRA_ALLOWED_ORIGINS, VERCEL_ENV, NODE_ENV, NEXT_RUNTIME` + script-only: `SEED_LOGIN, EMAIL, NEW_PASSWORD, VICTOR_PASSWORD, ALLOW_NON_DEMO, I_UNDERSTAND_THIS_IS_PROD, WORKER_COUNT, WORKER_INDEX, DEBUG, REBUILD`.

## 6. Audio subsystem (most complex part)

**Capture tiers** (best available wins; resolution in `electron/audio/captureTier.ts`, cached per session, degrades on failure):
1. **Tier 3 — Swift helper** (macOS, PREFERRED): `native/macos/Sources/PresentFlowAudioHelper` (built by `native/macos/build.sh` → `resources/native/macos/`). stdin JSON commands / stdout raw s16le 16kHz mono PCM / stderr JSON events. Managed by `electron/audio/swiftHelper.ts`; adds CoreAudio hot-plug (`audio:nativeDeviceChange`).
2. **Tier 2 — ffmpeg subprocess** (field-proven fallback, v0.1.80): `electron/audio/nativeCapture.ts` (+ `ffmpegPath.ts`, `deviceList.ts`, `multiChannelProbe.ts`, `pcmLevel.ts`). CoreAudio/DirectShow PCM from a main-process ffmpeg. Exists because Chromium getUserMedia SILENTLY DROPS 32-channel USB pro-audio (Allen & Heath SQ, JPD field test).
3. **Tier 1 — browser getUserMedia** (last resort / web): AudioWorklet + downsample to 16kHz linear16; multi-channel path via `src/lib/audio/multiChannelCapture.ts` (own AudioContext + splitter + per-channel analysers).

**Renderer-side libs** (`src/lib/audio/`): `captureMode.ts` (browser vs native selector), `nativeDeviceStore.ts` (native device pref + channel filter), `systemDefaultInput.ts` ("follow Mac system input" name-match), `deviceCategorization.ts` / `inputRanking.ts` (mic vs mixer heuristics), `deviceChannelPrefs.ts`, `vocalChannelDetector.ts` (auto-find the vocal channel), `customVocabulary.ts`, `mixerSetupGuides.ts`, `audioGuardian.ts` (self-healing watchdog: silence-escalation ladder restart → re-enumerate → probe alternates → needs-human).

**`useAudioStream` pipeline stages** (state machine in the hook): `opening_ws → requesting_mic → mic_granted → audioctx_ready → worklet_loaded → worklet_connected` (browser) OR native branch (IPC PCM chunks forwarded straight to WS). Client-side per-final-segment detection: `detectAll()` (`src/lib/ai-detection/`) + bible-parser bare-verse follow-ups + custom voice commands + translation-switch detection. Emits `UnifiedSuggestion`s (scripture/song/command) to the shell.

**End-to-end Deepgram flow**:

```
Mic / Mixer channel
  └─ Electron main: Swift helper (Tier 3) ─or─ ffmpeg (Tier 2)
       └─ IPC audio:nativePcmChunk (ArrayBuffer, 16kHz s16le mono)
     ─or─ Renderer: getUserMedia → AudioContext → AudioWorklet → downsample
  └─ useAudioStream (renderer)
       ├─ POST /api/audio/ticket  (Vercel mints HMAC ticket from AUTH_SECRET)
       └─ WSS → Fly.io bridge  scripts/audio-server.ts  (?planId&ticket)
            ├─ verifies ticket, per-user caps + rate limits
            ├─ Deepgram v5 streaming (server-side key; keyterms from
            │    deepgram-keyterms.ts + church_learned_keyterms; endpointing=100 — field-tuned, do not raise)
            ├─ interim → early-fire interim_final_candidate when it already parses
            │    (latency rule: detections must TRACK speech — CLAUDE.md rule 10)
            ├─ final  → persist transcript_segments; run bible-parser
            │    (accent repair: repairNumberHomophones, fuzzyBookMatch), song-parser,
            │    command-parser; semantic fallback via HTTPS →
            │    Vercel /api/internal/semantic-search (embeddings NOT on Fly)
            └─ push suggestions back over WS
  └─ useAudioStream dedupes interim-vs-final, client detectAll() enriches
  └─ ProOperatorShell autopilot: scripture AUTO-approve; song ≥70% auto-live,
       60–69% staged chip + G-key confirm; anti-replay/min-gap guards
  └─ broadcast.ts (BroadcastChannel) → /live /stage /livestream
       └─ realtime.ts (Supabase) → paired remote devices
  └─ session end: after() → sermon-rag.ts chunk+embed; metrics POST → audio_sessions
```

## 7. Design system

- **Tailwind v4, CSS-first**: NO `tailwind.config.*`; tokens live in `@theme` in `src/app/globals.css` (postcss plugin `@tailwindcss/postcss`).
- **App-chrome tokens (dark default)**: layered neutrals `--color-app-bg #000` < `panel #0e0b12` < `raised-shell #171319` < `elevated #1c1820`; single warm-orange brand accent `--color-brand #ff7a2c` / `brand-hi #ffb861` ("No cyan"); semantic `success/warning/destructive`; AI status tokens `--color-ai-{idle,listening,processing,approved}`; sidebar-specific tokens.
- **Light mode**: `html.light` overrides (warm ivory `#faf8f5`, terracotta `#cf5f1e`). Surface-dependent default in `src/app/layout.tsx`: web admin → LIGHT, desktop shell → DARK (detected via `x-pf-shell` header / `pf_shell` cookie); explicit `ff_theme` cookie wins. Toggle: `ui/theme-toggle.tsx`.
- **Admin-scope palette (in-progress redesign)**: `.pf-admin-scope` CSS-var block (ivory + deep terracotta `#9C481B`, signature purple→terracotta→pink gradient) — opt-in per container so operator surfaces are untouched. Design docs in `docs/ui-redesign/`.
- **Fonts**: Google Fonts via CSS `@import` in globals.css (NOT next/font) — `Sora` (display/headings), `Plus Jakarta Sans` (body), system mono.
- **Icons**: `lucide-react` throughout. Radix primitives for dialogs/popovers/tooltips/etc. Toasts: `sonner`.
- **SLIDE themes are a PRODUCT feature, distinct from app chrome**: `themes` DB table (config jsonb: fonts, colors, backgrounds per church), managed at `/library/themes` (`ThemesManager`) + operator `ThemesTab`, applied via `applyThemeToSong` / default theme, rendered by `live/SlideRenderer.tsx`. `src/lib/effects.ts` = slide text effects; announcements have their own styling model.

## 8. Electron shell (`electron/`)

- **`main.ts`** (745 lines): thin client — loads hosted URL (default `https://faithflow-ai.vercel.app`, `PF_APP_URL` override, localhost in dev). No local Next server, no secrets in bundle (see DECISIONS.md). Responsibilities: window + tray + splash, application menu (help links open system browser, host-allowlisted), `presentflow://auth?token=` deep-link login, static safe-host allowlists (anti-XSS-pivot hardening), `x-pf-shell: desktop` header injection for first-party hosts, safeStorage-backed license store, electron-updater (GitHub Releases) with update events to renderer.
- **`preload.ts`** → `window.electronAPI` namespaces: `screens` (list/assign/spawn/close), `audio` (+ `audio.native`: isAvailable/listDevices/start-stopCapture/start-stopChannelProbe/onPcmChunk/onLevel/onError/onChannelLevels), `dialog`, `fs` (readDirRecursive/readFile), `app` (version/platform), `shell.openExternal`, `license` (get/set/clear), `update` (onAvailable/onDownloaded/onError/installNow/retryDownload), generic `on/off`.
- **IPC channels**: `screens:{list,assign,spawn,close}` · `audio:{listInputs,listSystemSources,getMicPermissionStatus}` · `audio:native:{isAvailable,listDevices,startCapture,stopCapture,startChannelProbe,stopChannelProbe}` · push: `audio:{nativePcmChunk,nativeLevel,nativeError,nativeChannelLevels,nativeDeviceChange}` · `dialog:{openFile,openDirectory,showMessage}` · `fs:{readDirRecursive,readFile}` · `app:{version,platform}` · `shell:openExternal` · `license:{get,set,clear}` · `update:{available,downloaded,error,install-now,retry-download}`.
- **Windows**: main operator window + `windows/OutputWindow.ts` — fullscreen per-role output windows (projector/stage/stream) on assigned displays, loading `/live` `/stage` `/livestream` with shared session cookies.
- **`native/macos/`**: Swift Package `PresentFlowAudioHelper` (CoreAudio capture helper, §6 Tier 3); `entitlements/` for signing (DMG currently unsigned).

## 9. Test inventory (`test/`) — plain **tsx harness**, no jest/vitest: `npx tsx test/<file>.ts`

| File(s) | Covers |
|---|---|
| `actions.test.ts` | reorder validator pure functions |
| `ai-pipeline.test.ts`, `phrase-search`, `pd-search-and-actions` | detection pipeline, phrase search, public-domain search |
| `bible-*.test.ts` (6 files) | parser, completeness (66 books), add-verse, mode, perf, phrase search |
| `audio-hardening`, `swift-helper-protocol`, `deepgram-keyterms` | audio edge cases, Swift wire protocol, keyterm building |
| `voice-commands`, `translation-commands`, `keyboard-shortcuts` | command parsing, hotkeys |
| `multi-output`, `projector-output` | output routing/rendering |
| `propresenter-import`, `feedback-validation`, `tier.test.ts` | importers, feedback, tier gates |
| `test/adversarial/` (14 files) | cross-church leakage + prod invariants — REQUIRED before every ship (CLAUDE.md rule 5); `pair-code` has npm script `test:pair-code` |
| `test/e2e/onboarding.test.ts`, `test/dry-run/` | e2e onboarding; scripted full-service transcript replay (`run-dry-run.ts`) |
| Co-located: `src/lib/bible-parser.test.ts`, `src/lib/parsers/parsers.test.ts`, `src/lib/ai-detection/detection.test.ts`, `src/lib/server/bible.test.ts`, `src/tests/bibleDetection/` | unit tests beside sources |

## 10. Docs + ops

| Doc | One-liner |
|---|---|
| `docs/AGENT_WORKFLOW.md` | THE loop: Plan→Build→Review→Fix→Re-test→Ship→Report + 3 parallel review agents + checkpoint template |
| `docs/DMG_RELEASE_SOP.md` | READ BEFORE cutting a .dmg (version-align to changelog head, first-publish 422 workaround, never `git add -A`) |
| `docs/ADMIN_ROUTES.md`, `SUPABASE_SECURITY_CHECKLIST.md` | Route registry; security checklist |
| `docs/ui-redesign/` (6 files) | Admin visual overhaul: visual system, IA, page specs, roadmap, component inventory |
| `docs/operator-ai/` (5), `docs/licensing/` (4), `docs/automation-workflows/` (6), `docs/agents/` (2) | AI UX rules; Bible/CCLI licensing strategy; n8n/native workflow research; audio research + stale-code notes |
| Root: `BUILD.md, DEPLOY.md, DECISIONS.md, RELEASING.md, INSTALL.md, CHANGELOG.md` | Build/deploy runbooks, ADRs, release notes |

**Scripts** (`scripts/`): `release.sh` (bump + build unsigned mac dmg/zip + publish GitHub Release, auto-update pickup) · `deploy.sh audio|app|full` (Fly + Vercel driver) · `audio-server.ts` (the Fly WS bridge itself) · `build-tester.sh`, `setup-codesigning.sh`, `save-notarize-creds.sh` · DB: `migrate, seed, seed-bible, seed-hymns, seed-demo, reset, embed-bible(-shard), embed-sermons, prune-transcripts` · checks: `bible-coverage-check, song-coverage-check, check-bible, prod-walkthrough, dg-raw-test` · admin: `reset-user-password, check-users, verify-victor-login, apply-is-demo-prod`.

**CLAUDE.md rules (one line each)**: (1) the loop is the standard; (2) 3 parallel review agents for >100 LOC or sensitive areas; (3) tag findings 🔴/🟡/🟢; (4) checkpoint status blocks; (5) church_id scoping mandatory everywhere (Bible library only exception) + adversarial test for new paths; (6) Groq is the only AI provider; (7) song auto-live at ≥70% confidence with anti-replay guards (long ledger of signed-off carve-outs); (8) BroadcastChannel is primary sync, Realtime is additive; (9) parser must handle African-preacher accents/ASR mishearings; (10) detection latency: early-fire interims, endpointing=100 locked; (11) sermon RAG ingestion is server-side only.

## How to find things (cheat-sheet)

- Operator console logic/state → `src/components/operator/OperatorConsole.tsx`; layout/auto-fire → `pro/ProOperatorShell.tsx`; ctx type → `shell/types.ts`
- Audio capture → `electron/audio/*` (main) + `src/lib/audio/*` (renderer) + `operator/useAudioStream.ts` (pipeline) + `scripts/audio-server.ts` (bridge)
- Speech→scripture parsing → `src/lib/bible-parser.ts`; unified detection → `src/lib/ai-detection/`
- Slide rendering (all outputs) → `src/components/live/SlideRenderer.tsx`; sync → `src/lib/broadcast.ts` + `src/lib/realtime.ts`
- DB tables → `src/lib/db/schema.ts`; server-only helpers → `src/lib/server/*`; every mutation → `src/lib/actions.ts`
- Colors/fonts/tokens → `src/app/globals.css` (`@theme` + `.pf-admin-scope`); theme default logic → `src/app/layout.tsx`
- Slide themes (product) → `themes` table + `library/ThemesManager.tsx` + `actions.ts` theme cluster
- Tier/billing gates → `src/lib/tier.ts`, `src/lib/entitlement` (`src/lib/server/entitlement.ts`), `useTier`, Stripe in `billing-actions.ts` + `/api/stripe/webhook`
- Desktop shell behavior → `electron/main.ts`; renderer bridge → `electron/preload.ts` (`window.electronAPI`)
- What's New / release → `src/lib/changelog.ts` + `scripts/release.sh` + `docs/DMG_RELEASE_SOP.md`
