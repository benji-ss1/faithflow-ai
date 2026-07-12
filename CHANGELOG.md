# Changelog

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
