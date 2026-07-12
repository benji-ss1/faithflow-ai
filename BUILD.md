# BUILD.md — Present Flow Electron shell

## Development

Requires Node 20+ and the Next.js environment variables in `.env.local`
(Supabase, Deepgram, Groq, etc — see `.env.local.example`).

```bash
npm install
npm run electron:dev
```

`electron:dev` starts `next dev` on :3000, waits for it, compiles the electron
main/preload with `tsc`, and launches Electron pointing at the dev server.

## Preview a production build locally

```bash
npm run electron:preview
```

Runs `next build` (produces `.next/standalone/`), compiles Electron TS, then
launches Electron. The main process spawns the standalone Next server on a
random free port and points the BrowserWindow at it.

## macOS build (.dmg)

```bash
npm run electron:build
```

Requires Xcode Command Line Tools (`xcode-select --install`).

Code-signing is not yet configured. If it fails, set
`CSC_IDENTITY_AUTO_DISCOVERY=false` to skip signing.
Notarization requires an Apple developer account + app-specific password —
document these as blockers in `DECISIONS.md` when we're ready to ship.

## Windows build (.exe / NSIS)

```bash
npm run electron:build:win
```

Best run on Windows or through a CI Windows runner. Cross-building from macOS
requires `wine`.

## System dependencies

### macOS
- Xcode Command Line Tools (native modules — `@napi-rs/canvas`)
- **System audio capture** requires a virtual audio device such as
  [BlackHole](https://github.com/ExistentialAudio/BlackHole) or
  [Loopback](https://rogueamoeba.com/loopback/). macOS does not expose true
  system-audio loopback via `desktopCapturer` alone.

### Windows
- No extra dependencies for basic capture.
- Loopback capture works through `desktopCapturer.getSources({ types: [...] })`
  and the WASAPI backend via Electron.

## Multi-window testing

Testing multi-display output requires at least two physical displays (or one
physical + one virtual via macOS Display Mirroring off).

1. Launch the app.
2. Navigate to Settings → Screen Configuration (`/settings/screens`).
3. Assign a role (Projector / Stage / Livestream) to each secondary display.
4. Pick a preset (720p / 1080p30 / 1080p60 / 4K).
5. Click **Spawn** — a fullscreen frameless window appears on the target
   display loading `/live`, `/stage`, or `/livestream`.
6. Toggle **Auto-restore last session** so the mapping is recreated on launch.

## Audio bridge / Deepgram env

The transcription flow still uses the Fly.io-hosted audio bridge. The
following env vars are required in the runtime environment (either exported
before launching, or wired through the Next server's `.env.local` which the
standalone server inherits):

- `NEXT_PUBLIC_AUDIO_WS_URL` — WSS endpoint of the audio bridge
- `DEEPGRAM_API_KEY` — Deepgram Nova key (bridge-side)
- `GROQ_API_KEY` — Groq API key (server actions / detection pipeline)
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL` — Postgres (Supabase)

## Smoke test checklist (manual)

Because the automation harness cannot launch a GUI, manually verify after any
non-trivial change:

- [ ] `npm run electron:dev` — main window loads, no console errors
- [ ] Tray icon shows a menu with Show/Hide, Open Screen Config, Quit
- [ ] `/settings/screens` lists all connected displays
- [ ] Assigning Projector + Spawn opens a fullscreen frameless window on the
      chosen display
- [ ] Closing removes the window; re-spawn works
- [ ] Auto-restore restores assignments after quit → relaunch
- [ ] Audio input picker in Settings still enumerates devices (permission
      is pre-granted by the main process)
- [ ] Import wizard shows the new "Choose from computer…" button when in
      the desktop app; browser build is unaffected
- [ ] `npm run electron:build` produces `release/*.dmg` (unsigned, warn on
      Gatekeeper — that's expected without signing credentials)
