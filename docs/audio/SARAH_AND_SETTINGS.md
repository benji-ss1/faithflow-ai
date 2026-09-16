# Sarah + the Settings window — what shipped (2026-09-16)

Versions **0.1.415** and **0.1.416**. Patch notes: `changes/sarah-audio-setup.md`,
`changes/settings-window.md`, `changes/slide-actions-non-song.md`, `changes/sarah-inside-the-app.md`.

## 1. Sarah — the audio setup assistant

Where: **Settings → Audio Input → Run setup**. She opens as an overlay **inside the desktop
operator console** (`SarahOverlay`, event `presentflow:open-sarah`) — never a browser tab.

Flow: welcome (remembers last time) → Mac/Windows → desk → the 3 best ways to connect →
tickable steps → pick input (spots the moving channel on a 32/64-ch desk) → quiet check →
voice check → save → **first win** (say a verse, watch the AI catch it).

- **Grounded, not guessed.** Pass/fail comes only from `audioDiagnostics`. The Groq chat can
  only use `sarahKnowledge.ts` (server-side) and those results; invented menu paths are stripped.
- **Exact steps only where verified** (X32, Yamaha TF, Dante, Blackmagic). Everything else gets
  the general method + "check your desk's manual".
- **Remembers per machine** — device matched by CoreAudio uid, not the volatile index.
- **Failure is a path, not a dead end**: explains → fixes → re-tests → offers the next route,
  and remembers which route failed.
- **No gear?** Recommends a UMC202HD / Scarlett Solo + one cable, NDI from another computer, or
  the built-in mic meanwhile (always last, never "recommended").

### Live-console safety (the rules that keep a service safe)
- Sarah **refuses to probe while AI listening is on** — the desktop helper has one capture slot,
  so a probe would report the LIVE input's levels whatever device was picked, and she'd save the
  wrong one. She offers to switch listening off instead.
- **Saving asks first** when listening is on: writing the input pref restarts capture briefly.
- **Escape closes her** — shell hotkeys are suppressed while any dialog is open, so the operator
  always has a one-key route back to the projector.
- The meters are a **read-only probe**. Sarah never starts live capture.
- The **first win** only celebrates a detection that arrived *after* the step began.

## 2. Settings

Gear in the operator top bar, or `Cmd/Ctrl+,`. Sidebar grouped **Service / Output / Organisation /
System**, with search over sections *and* individual settings (naming which section a match is in).
Existing panels are reused as section bodies.

- Export / import this computer's settings; reset (our keys only, confirmed).
- Every link **opens in a new window** — navigating away would tear down the live console.
- Deep link: `window.dispatchEvent(new CustomEvent("presentflow:open-settings", { detail: { section: "audio" } }))`.

## 3. Slide actions on non-song slides
Media, sermon, blank and logo items. Scripture is excluded: its slide numbers move with the
translation, so an action could land on the wrong verse.

## Rollback
1. `vercel promote <previous-production-deployment>` — instant, no rebuild.
2. `git revert -m 1 <merge-commit>` — everything is additive.
3. `DROP TABLE IF EXISTS church_audio_profiles;` — nothing else reads it.

## Not yet verified
Real hardware: mic, desk, projector, NDI, Dante, Blackmagic, Windows. Sarah's meters, channel
spotting and the checks still need a field test on a real Sunday rig.
