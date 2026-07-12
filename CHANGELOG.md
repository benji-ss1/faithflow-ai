# Changelog

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
