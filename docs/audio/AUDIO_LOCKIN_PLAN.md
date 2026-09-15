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

## Blackmagic on macOS (research verdict)
Desktop Video exposes DeckLink/UltraStudio as CoreAudio inputs (2/8/16 ch embedded, 48 kHz);
embedded audio only exists while video is locked → treat all-zero as "no video signal".
DeckLink SDK NOT needed for audio on Mac (only for >16ch, lock detection, timecode,
Windows, video). Never bundle the runtime; users install Desktop Video. Legal review before any SDK use.
