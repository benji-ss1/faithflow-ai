# Sarah spotlight tour + watchers — plan (2026-09-16)

Owner directive: Sarah becomes a coach who moves around the REAL app — the console dims,
a lit cutout glides to the part she is teaching, she drives the real Audio panel, the first
win happens on the live preview, and she NOTICES hardware (NDI / Blackmagic / Dante / USB /
network) and explains what's wrong in plain English.

## Research verdicts
- **Build on `src/components/tutorial/OperatorTour.tsx`** — already an SVG-mask dimmer with
  `pointer-events: none`, ResizeObserver + re-query. No tour library: several block the backdrop
  by default (unsafe mid-service); Shepherd.js and Intro.js are AGPL.
- **Motion:** a hand-rolled critically-damped spring (~20 lines) on the cutout rect, written via
  refs (zero React renders per frame). No new dependency. Reduced motion = snap + fade.
- **Remotion** renders React to MP4 — right for a marketing/onboarding VIDEO of Sarah, not for a
  live interactive overlay.

## Live-console safety (non-negotiable)
1. The dim layer is visual only: `pointer-events: none`. Nothing outside Sarah's card is blocked.
2. No window keydown handlers that swallow keys. The existing tour captures Esc / arrows / Enter
   — operator slide hotkeys. Sarah uses her own buttons; Esc only closes.
3. Not a Radix modal (focus trap + Settings' ⌘, guard would interfere). Portal, `aria-modal="false"`.
4. Layers: dim `z-[85]` (above Settings `z-81`), coach card `z-[92]`.
5. Keep every existing Sarah rule: no probing while listening, save asks first, stale-win guard.

## Increments (each shippable alone)
1. **Spotlight engine** — `SarahSpotlight` + `useSpotlightTarget`: resolve `[data-tour=…]`,
   measure (RO + scroll/resize + rAF while open), spring-glide the cutout, place the coach card
   beside the target (flip/shift to stay on-screen), Esc closes. Renderer → Vercel.
2. **Real targets** — add `data-tour="live-preview"` (LivePreviewPanel aspect-video box),
   `data-tour="ai-pill"` (TopBar), `data-tour="hardware-audio"` (HardwarePanel slide-out) and a
   `presentflow:open-hardware {panel}` event in HardwarePanel. Also gives the dead
   `presentflow:open-audio-settings` handler (red ⚠ AUDIO chip) its job back. Renderer → Vercel.
3. **Sarah tours** — at the input step Sarah shrinks to a coach card, opens the real Hardware ›
   Audio panel and spotlights it; operator picks there; she watches the live pref + levels.
   First win: spotlight glides to the AI pill ("turn listening on"), then the live preview
   ("say the verse — watch it land here"). Renderer → Vercel.
4. **Watchers** — pure `sarahWatchers.ts` (testable) + `useSarahWatchers` hook. Renderer-only set:
   | # | Trigger | Sarah says | Fix |
   |---|---|---|---|
   | 1 | Guardian `needs-human` / `noAudioSignal` while listening | no sound from {device} | fader / mute / input |
   | 2 | `clipping` | input too hot — garbles transcription | lower desk gain |
   | 3 | selected uid missing after `devicechange` diff | {device} was unplugged | reconnect |
   | 4 | Blackmagic (pci/thunderbolt or name) + silent | card present, no audio | SDI/HDMI cable + source output |
   | 5 | Dante + silent | Dante VSC present but silent | route in Dante Controller |
   | 6 | Dante `sampleRate` ≠ 48000 | Dante at {rate} | match 48 kHz |
   | 7 | chose NDI, no NDI sources ~10s | no NDI sources — usually different network / Wi-Fi | same wired network |
   | 8 | NDI feed lost (`ndiAudio:error`) | NDI feed dropped | OBS / network |
   | 10 | reconnect attempts > 2 / failed | lost the speech service | internet, toggle AI |
   | 11 | `navigator.onLine` false | this computer is offline | reconnect |
   | 12 | sustained low `audioQuality` | audio is muddy | desk feed, not room mic |
   Positive watchers too: "I'm receiving your NDI", "I can see your interface — signal is good".

## Needs a DMG (NOT in these increments — listed for the owner)
- Expose `audio:nativeDeviceChange` through preload (instant hotplug instead of polling).
- Pass `manufacturer`, `is_default` and the native error `code` through `toNativeDevices`.
- `net:interfaces` IPC (wired vs Wi-Fi) → watcher #9 "you're on Wi-Fi, NDI is fragile".
- Blackmagic video-lock detection needs the DeckLink SDK — a larger project, not scheduled.

## Verification
Unit tests for the watcher rules and the spring; adversarial "does the spotlight ever block a
click or swallow a hotkey" test; 6–9 agent gate; real-hardware field test before relying on it.
