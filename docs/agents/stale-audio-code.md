# Stale-Code Audit — Audio Subsystem (v0.1.62 → v0.1.80)

Date: 2026-07-27 · Agent: stale-code · Read-only inventory. **No code was modified.** All DELETE items are recommendations only, with grep proof.

Capture paths in play:
- **Tier 1 (browser)**: Chromium getUserMedia → Web Audio (worklet, channel splitter) → base64 WS → Fly.io bridge
- **Tier 2 (native, shipped v0.1.80)**: ffmpeg subprocess in Electron main → IPC PCM → same WS bridge
- **Tier 3 (planned)**: Swift/C# helper — not present anywhere in the repo yet (verified: no Swift/C# audio sources exist)

Classification legend: **KEEP** (works, needed as-is) · **WRAP** (fold behind a unified AudioProvider when Tier 3 lands) · **QUARANTINE** (unclear ownership, don't touch without review) · **DELETE** (dead, grep-proven).

---

## 1. Electron main process

| File / function | LOC | Class | Rationale |
|---|---|---|---|
| `electron/audio/ffmpegPath.ts` | 78 | **KEEP** | Clean single-purpose path resolver + availability probe. Tier 3 helper would sit beside it, not replace it (ffmpeg remains the Tier 2 backend). |
| `electron/audio/deviceList.ts` | 180 | **WRAP** | Works (avfoundation + dshow parse, system_profiler channel counts). When Tier 3 lands, device enumeration should come from ONE `AudioProvider.listDevices()` — Tier 3's CoreAudio enumeration will be authoritative on mac; ffmpeg parse stays as the Tier 2 fallback. Migration: define `NativeDevice` in a shared types module; make deviceList one implementation. Linux path intentionally returns `[]` (documented). |
| `electron/audio/nativeCapture.ts` | 288 | **WRAP** | The v0.1.80 core. Solid (backoff restart, stderr classification, SIGTERM→SIGKILL). This is exactly the module Tier 3 will substitute — same contract (`startCapture`/`stopCapture`/`CHANNELS` events). Migration: extract `interface CaptureBackend { start, stop, events }`; nativeCapture becomes `FfmpegBackend`, Tier 3 becomes `HelperBackend`; `electron/ipc/audio.ts` routes to whichever is available. Note: `isCapturing()` export has **zero callers** (grep: only its definition) — harmless, but dead. |
| `electron/audio/multiChannelProbe.ts` | 178 | **WRAP** | Powers native channel-grid meters (one ffmpeg proc, JS interleave split). Same backend-swap story as nativeCapture. `isProbing()` export also has zero callers. **Note:** its renderer consumer exists only in the pro sidebar tab; the pro tab currently tells users "Per-channel picker coming in a follow-up" while this probe is fully wired — the follow-up UI is the gap, not the probe. |
| `electron/audio/pcmLevel.ts` | 64 | **KEEP** | Pure math, dependency-free, hot-path. Reusable by Tier 3 unchanged (any backend emitting Int16 PCM). |
| `electron/ipc/audio.ts` — `registerNativeAudioIpc` + `stopAllNativeAudio` | ~90 | **KEEP** | Correct lifecycle (lazy window getter, before-quit kill in `electron/main.ts:311,737`). Becomes the AudioProvider routing point under Tier 3. |
| `electron/ipc/audio.ts` — `audio:getMicPermissionStatus` | ~12 | **KEEP** | Used by `useAudioStream` NotAllowedError handling (code-signing diagnosis). |
| `electron/ipc/audio.ts` — `audio:listInputs` | ~8 | **DELETE (recommend)** | Returns only a hint payload `{strategy:"renderer-mediadevices"}` — it does nothing. Sole caller: `src/components/settings/SettingsForm.tsx:51` (web-admin settings page), which per the desktop-first rule shouldn't own operator audio anyway. Grep proof: `listInputs` appears only in preload.ts, ipc/audio.ts, electron.d.ts, SettingsForm.tsx. Remove handler + preload entry + SettingsForm call together. |
| `electron/ipc/audio.ts` — `audio:listSystemSources` | ~15 | **QUARANTINE** | desktopCapturer screen/window enumeration, labelled for Windows audio-loopback. Sole caller `SettingsForm.tsx:75`. No operator-path consumer. May be a seed for future system-audio capture — do not delete without confirming that plan is dead. |
| `electron/preload.ts` (audio block, lines 14–72) | ~60 | **KEEP** | Faithful mirror of the IPC surface. Trim `listInputs` if the handler goes. |
| `electron/main.ts` (audio sections: registration L535–541, kill hooks L311/L737, `audioCapture` permission L477, mic-permission logging L492) | — | **KEEP** | Correct and load-bearing. |

## 2. Renderer libs (`src/lib`)

| File | LOC | Class | Rationale |
|---|---|---|---|
| `src/lib/audio/captureMode.ts` | 111 | **KEEP** | The mode selector (auto/native/browser + `resolveEffectiveMode`). Already the embryo of the AudioProvider decision layer; Tier 3 adds a third effective mode here, nothing else changes. |
| `src/lib/audio/nativeDeviceStore.ts` | 108 | **KEEP**, with two dead fields | Native pref persistence + `buildChannelFilter` (consumed by `useAudioStream.ts:1475`). **Dead field #1:** `deviceChannel?: number` — "legacy shorthand", grep shows it is never read or written anywhere (only its own declaration + comment). **Dead field #2:** `gainDb` — written by the pro AudioTab (`writeNativeDevicePref({... gainDb: 0})`) but no consumer: `buildChannelFilter` ignores it and `startCapture` opts have no gain. Recommend removing `deviceChannel` and either wiring `gainDb` into the ffmpeg `-af` chain (`volume=XdB`) or dropping it. |
| `src/lib/audio/deviceCategorization.ts` | 174 | **KEEP** (regexes) / see Q3 for `getDeviceCapabilities` | Single source of truth for NDI/mixer/BT classification (deduped 2026-07-27 from 3 files — good). MIXER_RE is field-tested; do not touch. `getDeviceCapabilities` is browser-only by design but is currently invoked without a capture-mode guard — see Q3. |
| `src/lib/audio/multiChannelCapture.ts` | 323 | **KEEP** (see Q1) | NOT redundant. Consumers: `useAudioStream.ts:1752` (browser per-channel routing for live capture), both AudioTabs (browser channel grids), `VocalChannelAutoDetectModal`. Native probe only replaces it for the *native* path; browser mode (web app, unsigned dev shells, `browser` forced mode, native-start failure fallback at `useAudioStream.ts:1594`) all still depend on it. Under Tier 3 it becomes the `BrowserBackend`'s channel implementation behind the provider interface — WRAP-eligible then, KEEP now. |
| `src/lib/audio/deviceChannelPrefs.ts` | 259 | **KEEP** | Browser-mode per-device channel/gain persistence, well-sanitized, label-based migration for USB renumbering. Deliberately separate from the native store (different id spaces) — the separation is correct, but see §5 persistence-sprawl notes. |
| `src/lib/audio/mixerSetupGuides.ts` | 277 | **KEEP** | Static content + `findGuideForDevice`. Used by both AudioTabs. Capture-mode agnostic. |
| `src/lib/audio/vocalChannelDetector.ts` | 232 | **KEEP** (browser-only, see Q2) | Pure scoring service over a `MultiChannelCapture`. Only consumer is `VocalChannelAutoDetectModal`. Tier-3-ready in principle (the algorithm is transport-agnostic) but currently typed against the Web Audio capture — WRAP candidate later. |
| `src/lib/voice-commands.ts` | 185 | **KEEP** | Misleading filename, but everything is live: `matchCustomCommand`/`readCustomCommands` (voice commands), `readAudioInputPref`, `readAudioSourceType`, `audioConstraintsFor` (browser constraints incl. the 32-ch `ideal` fix) all consumed by `useAudioStream`. The `pref?.kind === "ndi"` branch in `audioConstraintsFor` is a documented no-op fallback (NDI capture handled via NDI Virtual Input devices, not a distinct kind) — keep for legacy stored prefs. Consider renaming/splitting `audio-input-prefs` out of `voice-commands` during the AudioProvider refactor. |

## 3. Renderer components

| File / area | LOC | Class | Rationale |
|---|---|---|---|
| `src/components/operator/useAudioStream.ts` — native branch (L1431–1618) | ~190 | **KEEP** | v0.1.80 core: mode resolve, ffmpeg start, PCM→ring-buffer→WS, level/no-signal parity with browser path, fallback-to-browser on any failure. Correct generation-guarding. |
| `useAudioStream.ts` — browser branch (`acquireSumAllStream`, per-channel routing L1694–1805, worklet/preprocessing ~L1839–2160) | ~700 | **WRAP** | Required for web app + fallback. Under Tier 3 this is the `BrowserBackend`. Migration: the hook is ~2454 LOC doing mode-select + two transports + Deepgram WS + detection dispatch + metrics; extract `createBrowserCapture()` / `createNativeCapture()` returning a common `{onChunk,onLevel,stop}` so the hook shrinks to orchestration. Do this WITH the Tier 3 work, not before (field-hardened code, high regression cost). |
| `useAudioStream.ts` — remainder (WS lifecycle, keep-alive, metrics retry queue, voice-command dispatch) | ~1500 | **KEEP** | Transport-agnostic; both branches feed it. |
| `src/components/operator/pro/right/tabs/AudioTab.tsx` (sidebar popover) | 915 | **KEEP** (most current picker) | Only surface with the capture-mode toggle + native device picker + native channel-probe wiring. Two bugs noted in Q3/Q5 answers below (unguarded `getDeviceCapabilities`; channel grid + Auto-detect render from browser selection even when native is active). Native per-channel picker UI is stubbed ("coming in a follow-up") even though probe + store + filter-builder all exist. |
| `src/components/operator/settings/tabs/AudioTab.tsx` (settings page) | 945 | **QUARANTINE** for the picker section / **KEEP** for the advanced controls | The voice-command / auto-pause / mic-boost / hold-during-song controls are the canonical home for advanced settings. But the entire Input-picker + channel-grid section (~L443–717) is 100% browser-mode with **zero awareness of native capture** — see Q5. Do not extend this file's picker; converge on the shared hook (Q7) or point it at the sidebar picker's logic. |
| `src/components/operator/AudioDiagnosticsScan.tsx` | 365 | **KEEP** (browser-only, label it) | Sequential getUserMedia signal scan. Useful for browser mode + web app. In native mode its results are misleading (it tests the Chromium path the pipeline isn't using — Chromium famously reports silence on the 32-ch devices native mode exists to fix). Recommend a "browser-path only" banner or native-mode variant using `startChannelProbe`. |
| `src/components/operator/VocalChannelAutoDetectModal.tsx` | 586 | **KEEP** (browser-only, see Q2) | Imports only `multiChannelCapture` + `vocalChannelDetector` — pure getUserMedia. Functional in browser mode; in native mode it's reachable (see Q2) and both misleading and a potential device-contention source. |
| `src/components/setup/AudioSetupWizard.tsx` (+ `src/app/(app)/setup/audio/page.tsx`) | ~400 | **QUARANTINE → DELETE-candidate wiring** | Pre-rebrand generation. Persists to `ff.audio.preferredLabel`, `ff.audio.preferredDeviceId`, `ff.audio.presets` — **grep-proven: no reader anywhere** (`grep -rn "ff\.audio\." src` matches only this file). Its device pick has zero effect on the pipeline (which reads `presentflow.pro.audioInput.v1`). Still linked from the Electron Help menu ("Microphone Setup" → `/setup/audio`, `electron/main.ts:248`). Actively misleading: an operator can "complete" mic setup here and change nothing. Recommend: rewire the wizard to write `presentflow.pro.audioInput.v1` (small fix) or retire the page + menu link. Don't delete the file until the Help-menu link is decided. |
| `src/components/operator/dev/AudioDebugOverlay.tsx` | small | **KEEP** | Dev overlay over `AudioStreamState`; mode-agnostic. |

## 4. Server

| File | LOC | Class | Rationale |
|---|---|---|---|
| `scripts/audio-server.ts` | 1164 | **KEEP** | Fly.io Deepgram bridge; both capture modes converge on it (base64 PCM over WS). Governed by CLAUDE.md non-negotiable #10 (endpointing=100, interim early-fire). Out of scope for capture-path refactors. |

## 5. Persistence map (localStorage)

| Key | Written by | Read by | Verdict |
|---|---|---|---|
| `presentflow.pro.audioInput.v1` | both AudioTabs, AudioDiagnosticsScan (via onSelectDevice→persistSelection) | `voice-commands.readAudioInputPref` → useAudioStream; both AudioTabs | **KEEP** — browser-mode device pick |
| `presentflow.pro.audioSourceType.v1` | both AudioTabs (incl. mixer auto-switch) | `readAudioSourceType` → constraints + preprocessing | **KEEP** |
| `presentflow.pro.audioCaptureMode.v1` | `captureMode.writeCaptureMode` (pro AudioTab toggle) | `readCaptureMode` → useAudioStream + pro AudioTab | **KEEP** |
| `presentflow.pro.audioInputNative.v1` | `nativeDeviceStore` (pro AudioTab) | useAudioStream native branch, pro AudioTab | **KEEP** (with dead `deviceChannel`/`gainDb` fields, §2) |
| `presentflow.pro.deviceChannelPrefs.v1` | `deviceChannelPrefs` (both AudioTabs, auto-detect accept) | useAudioStream per-channel routing, both AudioTabs | **KEEP** |
| `presentflow.pro.micBoost.v1` / `micHighpass.v1` | settings AudioTab | useAudioStream preprocessing (L2092–2095) — **browser worklet path only**; native branch never applies boost/high-pass | **KEEP**, but document the mode gap: settings sliders silently do nothing in native mode |
| `presentflow.pro.voiceCommands.v1` / `voiceCommandsEnabled.v1` | settings AudioTab | `readCustomCommands` → useAudioStream | KEEP (mode-agnostic — works in native, transcript-side) |
| `ff.audio.preferredLabel` / `preferredDeviceId` / `presets` | AudioSetupWizard | **nobody** | **DEAD — written, never read.** Grep proof above. |
| (removed) `INPUT_GAIN_KEY` | — | — | Already deleted 2026-07-25; only a comment remains (`settings AudioTab:803`). No action. |

No keys are read-but-never-written (all readers have a live writer).

## 6. Answers to the specific questions

**Q1 — Is `multiChannelCapture.ts` redundant?** No. It is the live per-channel router for browser mode (`useAudioStream.ts:1752`), the meter source for both channel grids, and the input to the vocal auto-detect. The native probe covers metering only in native mode on desktop. Web-app users, forced-browser mode, unsigned/dev shells, and the native-start-failure fallback all still route through it. KEEP; wrap behind the provider interface when Tier 3 lands.

**Q2 — VocalChannelAutoDetectModal in native mode?** Browser-only by construction (imports `multiChannelCapture` + `vocalChannelDetector`; opens its own getUserMedia). It is *reachable while native mode is active*: in the pro sidebar tab the "Auto-detect vocal" button lives in the channel-grid block (L696) which gates on the **browser** device selection + probed channel count, NOT on `effectiveMode`. If a browser device pref persists from before the mode switch, the grid + button still render. Result: modal scans the Chromium view of the device (may be silent — the exact failure native mode fixes) while ffmpeg may simultaneously hold the device (CoreAudio device-busy risk noted in useAudioStream L1470–1474). It writes to `deviceChannelPrefs` (browser store), which native capture ignores. Not "broken" code, but **wrong-mode and misleading** — should be hidden when `effectiveMode === "native"`.

**Q3 — `getDeviceCapabilities` in native mode?** Yes, it fires where it shouldn't. Both AudioTabs run it in the device-changed effect (pro `AudioTab.tsx:195`, settings `AudioTab.tsx:202`) keyed only on `selected?.id` — no `effectiveMode` guard. In native mode with a lingering browser selection, opening the sidebar popover or the settings Audio tab opens a throwaway 32-ch getUserMedia stream. Mostly harmless (short-lived) but it (a) can trigger CoreAudio contention with a running ffmpeg capture and (b) drives rendering of browser-mode UI that native ignores. Recommend guarding both call sites with `effectiveMode === "browser"`.

**Q4 — Keys written but never read?** Three: `ff.audio.preferredLabel`, `ff.audio.preferredDeviceId`, `ff.audio.presets` (AudioSetupWizard). Plus two dead *fields inside* a live key: `audioInputNative.v1`'s `gainDb` (written, never consumed) and `deviceChannel` (never written or read). No read-without-write keys.

**Q5 — Settings-page AudioTab in native mode?** Yes, actively misleading on four counts: (1) shows the browser device picker as if it selects the pipeline input — in native mode it doesn't; (2) its default when nothing is stored is `{kind:"ndi", id:"ndi:default", label:"NDI Audio (Routed)"}` (L97) so a fresh install displays "NDI Audio (Routed)" as the selected input while the pipeline actually uses the default mic (the NDI-placeholder cleanup removed the fake list entries but not this fake default); (3) the channel grid + auto-detect run getUserMedia probes against a device native capture isn't using; (4) Mic Boost / rumble-filter sliders only affect the browser worklet — silent no-ops under native capture, with no hint. It has no capture-mode toggle and no native picker at all.

**Q6 — NDI / dead IPC remnants?** Clean-ish. `listNdiSources` exists only as a history comment (`settings AudioTab.tsx:157`); the hardcoded NDI placeholders were removed 2026-07-26; NDI now = real enumerated devices labelled "NDI" plus help copy. Remaining remnants: the `kind: "ndi"` type variant + `ndi:default` default in the settings tab (Q5 item 2) and the documented NDI no-op branch in `audioConstraintsFor`/`useAudioStream:1623`. Dead-ish IPC: `audio:listInputs` (no-op payload, web-admin only caller — DELETE-recommend), `audio:listSystemSources` (QUARANTINE), and unused exports `isCapturing`/`isProbing`.

**Q7 — AudioTab duplication.** The browser channel-grid logic is duplicated near-verbatim between the two tabs: capability probe + pref hydrate + label-migration effect (~55 lines each), capture-open/poll/active-map effect (~50), `commitPref`/mode-change/channel-click/gain-drag-debounce handlers (~90), grid + gain + guide JSX (~140 sidebar vs ~160 settings, differing only in grid columns/styling), plus the diagnostics + auto-detect modal mounts. **≈300 duplicated logic LOC and ≈150 near-duplicated JSX LOC — roughly 40–50% of each file, and effectively ~90% of the channel-grid feature itself.** They have already drifted once (the 6c/stress-fix comments were patched in both by hand; settings has Clear-pref button + peak/ratio footer + tips that the sidebar lacks). Extract opportunity: `useChannelGrid(deviceId, label, {enabled})` hook returning `{channelCount, levels, activeMap, gridMode, selectedChannels, gainDb, handlers…}` + a presentational `<ChannelGrid columns={2|4}>`. Do it before adding native per-channel UI, or the duplication doubles to four copies.

## 7. Recommended sequencing (no action taken)

1. Guard `getDeviceCapabilities` / channel-grid / auto-detect behind `effectiveMode === "browser"` in both tabs (small, removes the misleading-UI + contention risks).
2. Fix the settings-tab `ndi:default` fake default; add a capture-mode banner ("Native capture active — this picker controls browser mode only") or port the mode toggle there.
3. Extract `useChannelGrid` shared hook (Q7) — prerequisite for native per-channel UI.
4. Wire or drop `NativeDevicePref.gainDb`; drop `deviceChannel`; drop `isCapturing`/`isProbing` exports; drop `audio:listInputs` (+ SettingsForm call).
5. Decide AudioSetupWizard: rewire to `presentflow.pro.audioInput.v1` or retire page + Help-menu link.
6. Tier 3: introduce `CaptureBackend` interface at `electron/ipc/audio.ts` + renderer `AudioProvider` at `captureMode.ts`; nativeCapture/multiChannelProbe/browser branch become implementations. Do NOT restructure `useAudioStream` before that milestone.
