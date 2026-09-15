# Audio Lock-In — implementation plan (2026-09-15)

Owner directive (2026-09-15): replace Phase 5 output routing (deferred — too long/risky
for launch) with **Audio Lock-In**: every input the OS exposes works, a deep AI-guided
first-time setup wizard, saved devices, backup-source failover, a passive in-service
watchdog, and a success screen. **Zero regression to live detection is the #1 rule.**
Bluetooth mics: out of scope.

## What already exists (reuse, don't rebuild)
- Swift helper already emits stable device `uid`, `transport`, channel count, hot-plug
  events (`DeviceEnumerator.swift`), per-channel probe (`ChannelProbe.swift`), and picks
  channel N of 32/64 (`AudioCapture.swift`). uid/transport already reach the renderer
  via `electron/ipc/audio.ts` — only the preload *type* omits them.
- `src/lib/audio/`: `deviceCategorization.ts` (ndi/mixer/bluetooth/mic/other),
  `inputRanking.ts`, `nativeDeviceStore.ts` (index+name, no uid), `deviceChannelPrefs.ts`,
  `audioGuardian.ts` (restart → re-resolve → alternates on error/device-loss → human),
  `mixerSetupGuides.ts`.
- `src/components/setup/AudioSetupWizard.tsx` (browser-only, writes a legacy key the
  live pipeline doesn't read) at `/setup/audio`.
- `src/lib/ai-helpers.ts` `groqJson` + `/api/ai/helpers/[action]` pattern (MISSING_API_KEY, rate limit).

## Architecture
```
Swift helper ─(uid,transport,levels,probe)→ swiftHelper.ts ─IPC→ renderer
 READ-ONLY (new): signalAnalyzer → audioDiagnostics (deterministic pass/warn/fail JSON)
                  deviceClassifier (transport + manufacturer + name)
 AudioLockInWizard ─POST→ /api/ai/audio-guide (Groq explains diagnostics + KB; never decides)
 savedAudioDevices → nativeDeviceStore (existing API)   backupSource → audioGuardian step 3 (one hook)
 AudioWatchdogChip ← GUARDIAN_STATE_EVENT (subscribe only)
 useAudioStream / Deepgram / detection: UNCHANGED
```

## Increments (each ships alone, smallest first)
1. Classifier (Blackmagic/AJA/capture/Dante/desk/interface/aggregate/NDI/builtin) + saved
   devices (match uid → exact name → normalized name + channel count; never deviceId/index)
   + auto-select on launch ONLY when not listening, silent pref write. Vercel.
2. Watchdog chip (read-only). Vercel.
3. Diagnostics + knowledge base + AI guide route + wizard (per-channel meters, noise floor,
   level test, Deepgram test read) behind `NEXT_PUBLIC_AUDIO_LOCKIN`. Old wizard stays as fallback. Vercel.
4. Success screen (shader/motion, reduced-motion fallback, auto-close). Vercel.
5. Backup failover: guardian step 3 tries registered backup first on device loss/error only;
   silence = suggestion only; auto-return after primary stable 10s; logged. Flag OFF until
   hardware-verified. Vercel.
6. (Optional, DMG) preload type tidy; uid for ffmpeg/Windows tier.

## No-regression boundary
Must NOT change: `useAudioStream.ts`, `nativeCapture.ts`, `captureTier.ts`,
`multiChannelProbe.ts`, all Swift, `electron/ipc/audio.ts`, guardian steps 1/2/4 +
thresholds, detection/bible code, `deviceChannelPrefs.ts`. Proof: `git diff --stat
origin/main -- <list>` empty except the single guardian hunk; existing audio + detection
suites green; wizard hard-blocks probing while `listening`; chip has no bridge calls.

## Tests
Unit: device-classifier fixtures, saved-device matching, signal analyzer (synthetic
hum/clip/silence), diagnostics snapshot, guide route (no key / rate limit / grounded
prompt), guardian-backup (error → backup; silence → never; 10s return; flap guard).
E2E: mocked bridge wizard → success → close; no-key static guide.
Hardware (owner): Scarlett, X32/SQ channel N, UltraStudio/DeckLink, ATEM Mini, HDMI dongle,
Dante VSC, aggregate, NDI; unplug primary mid-service → backup → replug → return;
11 min silence → no switch; full service with flags on, detection latency = baseline.

## Risks
🔴 guardian hunk (only live-capture edit) — flag-gated. 🔴 auto-select mid-service —
guarded by listening check. 🔴 wizard probe vs single native capture slot — blocked while listening.
🟡 ffmpeg/Windows no uid → name fallback. 🟡 device-name variance → "other" bucket.
🟡 LLM advice → grounded on diagnostics + KB only. 🟢 additive-only storage.

## 7-agent gate (2026-09-15) — findings fixed before merge
- 🔴 **Cross-church application leak** (security + stress agents): a guessable church name
  ("Grace") matched another church's application and exposed desk/device/applicant/city.
  FIX: `scoreApplication` now releases `setup` ONLY when an identity signal matches (same
  email, VERIFIED team member email, or the church's own non-free-mail domain); a name-only
  match returns `{churchName}` and can never be `high`. Similarity is measured against the
  LARGER token set, location tokens are ignored, accents are stripped (NFKD + combining marks),
  and a "conflict" needs distinctive tokens on both sides. Adversarial test:
  `test/adversarial/audio-setup-context.test.ts` (12 checks, needs a localhost DB).
- 🔴 **Client-supplied knowledge went into a system prompt** (AI agent): moved server-side to
  `src/lib/audio/sarahKnowledge.ts`, keyed by `step`; diagnostics whitelisted to {id,status,value};
  CONTEXT now travels as delimited user content; temperature 0.2; `stripUngroundedPaths` replaces
  any "A → B" menu path Sarah wasn't given with "check your desk's manual".
- 🔴 **Timers kept running after Back/exit** (reviewer + stress): all timeouts live in a ref,
  are cleared on Back/phase change/unmount, and each long step carries a run id.
- 🟡 Also fixed: POST profile needs `operate_services`; `/api/ai/audio-guide` requires AI
  entitlement + evicts its rate-limit map; `confirmedApplicationId` is re-verified server-side;
  missing-table detection also reads `err.cause.code === "42P01"`; AI corrections validated
  against the enums AND saved; desk brand + typed model combine; probe generation guard and
  friendly probe errors; double-click guards on device pick / save; AI chat aborts after 12s;
  64-channel grid; `saveWorkingDevice` reports quota failure; identical-uid devices disambiguate
  by name; demoted backups can't outrank the primary.
- 🟡 Audio guidance corrected (AI agent): the golden rule is now a **dedicated post-fader aux or
  matrix, dry, vocals forward** (Main L/R only as fallback); A&H SQ / PreSonus / Soundcraft /
  Wing steps are marked UNVERIFIED (general method + manual); X32, TF, Dante and Blackmagic stay verified.
- 🟡 Diagnostics: noise floor warn moved -50 → -45 (real desks idle there), clipping needs 3
  consecutive frames ≥ -0.25 dBFS or ≥2%, |peak| is used, digital silence is detected, and
  meters show plain bands (No sound / Too quiet / Good / Too loud).
- 🟡 Design: visible focus on steps + channels, success dialog takes focus / Escape / 10s with
  cancel-on-interaction, wizard pins its own dark tokens (app light theme can't wash it out),
  ≥11px type, role="log"/"meter", pre-blurred halo + scaleX meter, 30fps shader paused when
  hidden, compact <900px layout.
- 🟢 No-regression agent: `git diff origin/main` over useAudioStream / electron / native /
  audioGuardian / deviceCategorization / deviceChannelPrefs / nativeDeviceStore / ai-detection /
  bible-parser / scripts is EMPTY. Legacy wizard unchanged when the flag is off.
- **Still open:** merge `origin/main` into this branch before shipping; Sarah's 6 portraits must
  be saved to `public/sarah/`; the migration must be applied before deploy; real mic/desk field test.

## Blackmagic on macOS (research verdict)
Desktop Video exposes DeckLink/UltraStudio as CoreAudio inputs (2/8/16 ch embedded, 48 kHz);
embedded audio only exists while video is locked → treat all-zero as "no video signal".
DeckLink SDK NOT needed for audio on Mac (only for >16ch, lock detection, timecode,
Windows, video). Never bundle the runtime; users install Desktop Video. Legal review before any SDK use.
