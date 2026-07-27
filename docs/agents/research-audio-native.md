# Research: Tier 3 Native Audio Helper (Swift/C#) vs shipped ffmpeg pipeline

Research agent report — 2026-07-27. Evidence drawn from this repo at commit `1cc897e` (v0.1.80, JUST shipped, untested in field).

## What v0.1.80 actually is (verified in code)

- `electron/audio/ffmpegPath.ts` — resolves ffmpeg-static, asarUnpacked (`package.json` files + `asarUnpack: "**/node_modules/ffmpeg-static/**"`), availability probe with 3s timeout, cached.
- `electron/audio/deviceList.ts` — enumeration via `ffmpeg -f avfoundation -list_devices true` (stderr parse) on macOS, `-f dshow` on Windows. Channel counts + sample rate come from a **second source**: `system_profiler SPAudioDataType -json`, fuzzy-name-matched.
- `electron/audio/nativeCapture.ts` — one ffmpeg subprocess, `-i :<index>`, optional `-af pan=...` channel filter, `-ac 1 -ar 16000 -f s16le` → stdout → per-chunk ArrayBuffer over `webContents.send("audio:nativePcmChunk")`. Auto-restart with 2/4/8/16/30s backoff; stderr classification (busy / disappeared / permission / missing binary).
- `electron/audio/multiChannelProbe.ts` — one ffmpeg process, all N channels at 8kHz, JS-side `splitInterleaved` → 32 live meters at 20Hz for the channel-grid picker.
- Renderer (`src/components/operator/useAudioStream.ts` ~1449-1600): native branch sends `{ type: "audio", b64 }` JSON frames (base64, NOT binary WS frames) at 16kHz mono to the Fly bridge; `scripts/audio-server.ts` decodes `Buffer.from(msg.b64, "base64")` (line 1095) and forwards to Deepgram (`encoding: "linear16", sample_rate: "16000"` — lines 205-206).
- Preferences: `src/lib/audio/captureMode.ts` (auto/native/browser, auto→native when available), `nativeDeviceStore.ts` (stores ffmpeg's **numeric index** + name + channel selection; `buildChannelFilter()` bakes `pan=mono|c0=cN`).
- Fallback already exists: native start failure → catch → browser getUserMedia path (defence-in-depth comment at line ~1434).

Build config: `identity: null` (UNSIGNED), `hardenedRuntime: true`, entitlements include `com.apple.security.device.audio-input`, dmg+zip arm64 only (per DMG SOP: unsigned/arm64).

---

## 1. Capability matrix — ffmpeg (shipped) vs Swift helper (proposed)

| Capability | ffmpeg v0.1.80 | Swift helper | Verdict |
|---|---|---|---|
| Reaches CoreAudio directly (fixes SQ-5 silence) | YES — avfoundation uses CoreAudio, same layer as OBS/Logic | YES | **Tie.** The core field bug is (probably) already fixed. |
| Device enumeration fidelity | Names only from ffmpeg stderr parse; channels/SR bolted on via `system_profiler` + fuzzy name match (brittle: code itself notes "Default - SQ..." vs "SQ - Audio" mismatches) | First-class: `AudioObjectGetPropertyData` gives UID, name, channel layout, SR, transport type, aggregate membership in one call | **Swift wins**, but current fuzzy match is adequate for one known mixer. |
| Persistent device IDs | NO — avfoundation `:N` index is a position in the enumeration order at spawn time. Replug/reboot reorders. Confirmed risk: `nativeDeviceStore` persists `index` to localStorage; a replug can silently point at the wrong device. Mitigation already half-present: `resolveDeviceLabel()` re-enumerates at spawn, but matches by index, not name. | YES — CoreAudio device UID (`kAudioDevicePropertyDeviceUID`) is stable across replug/reboot | **Swift wins.** BUT a ~20-line TS fix (persist name, re-resolve index by name at start) closes 90% of the gap without Swift. |
| Live channel switch without restart | NO — `-af pan=` is fixed at spawn; channel change = kill + respawn (~0.5-1.5s gap, avfoundation device open is the slow part) | YES — retap/remap in the render callback, zero-gap | **Swift wins**, marginal UX value: channel selection happens at setup, not mid-service. |
| Latency | avfoundation default buffering + ffmpeg internal buffering + pipe: roughly 50-200ms to first byte of a chunk; chunks land "every ~50-100ms" (renderer comment) | Can run 5-20ms CoreAudio buffers → ~10-30ms | Swift wins on paper; **immaterial** (see §4). |
| Binary size | ffmpeg-static ~25-70MB per arch (universal ffmpeg is huge) | Swift helper ~100-500KB | Swift wins; only matters for DMG download size. |
| Multi-arch | ffmpeg-static ships per-arch binaries; current build is arm64-only anyway | Xcode universal binary trivially | Tie in practice. |
| Signing/notarization complexity | One extra Mach-O in asar.unpacked — electron-builder signs it automatically when a cert exists | Same story, plus you must build/sign it in CI yourself | **ffmpeg simpler** (zero extra build toolchain). Both blocked on the same missing Apple cert. |
| Error semantics | stderr string sniffing (`classifyStderr` greps for "input/output error" etc.) — fragile across ffmpeg versions | Typed OSStatus codes, structured JSON events | Swift wins on robustness; current sniffing covers the 4 cases that matter. |
| Auto-recovery | Already built (backoff, restart, healed-reset) | Would need rewriting from scratch | **ffmpeg wins — this code exists and is tested in review, Swift starts at zero.** |
| Device hot-plug notifications | NO (poll/re-enumerate only) | YES (`kAudioHardwarePropertyDevices` listener) | Swift wins; nice-to-have. |
| Windows | Same ffmpeg binary, dshow, already written | Entire second codebase (C#/NAudio) | **ffmpeg wins massively.** |

Honest summary: Swift genuinely wins on **stable device IDs, hot-plug events, structured errors, sub-50ms latency, binary size**. ffmpeg is Good Enough on **the actual field bug (CoreAudio access), enumeration, channel routing, recovery**, and is **already written, reviewed, and shipped**.

## 2. Swift framework choice

- **Enumeration:** CoreAudio HAL C API (`AudioObjectGetPropertyData` on `kAudioObjectSystemObject` / `kAudioHardwarePropertyDevices`) — the only way to get UIDs, transport type, aggregate composition, and hot-plug listeners. AVAudioEngine/AVCaptureDevice enumeration is a lossy subset.
- **Capture:** AVAudioEngine `inputNode` is the pragmatic choice — it handles format conversion plumbing and is far less code than a raw HAL IOProc.
- **Non-default device with AVAudioEngine — confirmed technique:** AVAudioEngine's inputNode wraps an AUHAL AudioUnit. You set the device via:
  `AudioUnitSetProperty(engine.inputNode.audioUnit!, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &deviceID, size)` **before** `engine.start()`, where `deviceID` is the `AudioDeviceID` you resolved from the UID. This is the well-established pattern (same one OBS-adjacent tools and simple recorders use); the alternative is temporarily switching the *system* default input, which is unacceptable. Caveat: must be re-applied after `AVAudioEngineConfigurationChange` notifications.
- **BlackHole / NDI Virtual Input / aggregates:** yes — all three register as ordinary CoreAudio devices (BlackHole is a HAL plugin driver, NDI installs a virtual device, aggregates are first-class HAL objects), so both HAL enumeration and AUHAL capture see them. This is actually a Swift *advantage*: ffmpeg's avfoundation input has historically been flaky with some aggregate devices' channel maps.
- Recommended split if built: HAL for enumerate/watch, AVAudioEngine(+AUHAL device pin) for capture, `AVAudioConverter` for resample. Skip `AudioHardwareBase.h`-level IOProcs unless AVAudioEngine misbehaves on the SQ-5.

## 3. Format negotiation

- SQ-5 USB (SQ-Drive/USB-B audio) exposes **48kHz or 96kHz**, 32-in/32-out, 24-bit — no 16kHz native mode. So resampling to Deepgram's 16k is mandatory in every design (ffmpeg does it today with `-ar 16000`, using its swresample default which is fine for speech).
- `AVAudioConverter` 48k→16k: exact 3:1 ratio, cheapest possible case. CPU cost is negligible (<1% of one core for mono). Quality settings (`sampleRateConverterQuality`) barely matter for ASR — Deepgram's acoustic model dominates. 96k→16k (6:1) equally trivial. No advantage either way vs ffmpeg here.

## 4. Latency budget

Current (ffmpeg): CoreAudio HW buffer (~10ms) → avfoundation/ffmpeg internal buffering (~20-100ms, the biggest and least controllable hop) → stdout pipe (<1ms) → main-process chunking + IPC structured-clone (~1-5ms) → base64+JSON WS to Fly (~10-50ms network) → Deepgram (~200-400ms endpointing/inference, `endpointing=100` per CLAUDE.md rule 10).

Swift: CoreAudio buffer 5-20ms → stdout pipe <1ms → IPC ~1-5ms → same WS + Deepgram.

Delta: **Swift saves perhaps 30-100ms** on a pipeline whose floor is 200-400ms of Deepgram plus network. For verse-detection UX (rule 10: "detections must track live speech") this is a ~10-20% improvement — perceptible in aggregate but nowhere near the value of the interim-early-fire work already done in `scripts/audio-server.ts`. **Not material enough alone to justify Tier 3.** Note also: the base64-JSON framing inflates WS payloads 33%; switching the bridge to binary frames would be a cheaper latency/bandwidth win than a Swift helper and benefits BOTH capture paths.

## 5. Packaging / signing

- Mechanism: put the compiled helper in `build/` and add to `package.json` `mac.extraResources` (or `extraFiles`); electron-builder deep-signs every Mach-O in the .app when `identity` is set, applying `entitlementsInherit` (already present: `electron/entitlements/entitlements.mac.inherit.plist`) to child executables. The helper needs `com.apple.security.device.audio-input` + hardened-runtime inherit — the inherit plist must be checked for that key before shipping.
- Current reality: **`"identity": null` — builds are unsigned** (no Apple Developer cert; DMG SOP confirms unsigned/arm64, testers get the right-click-open Gatekeeper dance). Notarization of a helper requires nothing *extra* beyond what the app itself already lacks: a Developer ID cert, hardened runtime on every binary, and notarytool submission of the whole DMG. So the helper adds no *new* signing requirement — but the whole signing project is still pending.
- **Does an unsigned Swift helper run on a tester's Mac?** Yes, with the same caveat as today's ffmpeg: Gatekeeper quarantine applies to the *downloaded* .app bundle; once the user bypasses it (right-click → Open, as the SOP prescribes), execution of bundled binaries spawned by the app is permitted. On Apple Silicon, macOS requires *some* code signature for arm64 binaries — an ad-hoc signature (`codesign -s -`, which Xcode/`swiftc` linking applies by default) suffices, exactly as ffmpeg-static's binary runs today. Proof by existence: **v0.1.80 already spawns a bundled third-party binary from an unsigned app** — if that works in the field, a Swift helper faces no additional barrier. TCC mic permission attributes to the responsible (parent) process, so PresentFlow's existing mic grant covers the child.

## 6. Windows reality check

Current user base is macOS only (JPD Mac Studio). The C# helper is: NAudio/WASAPI capture app, .NET runtime decision (self-contained publish ~70MB or framework-dependent), separate CI build, separate code-sign story (Authenticode cert — also not owned), and a second protocol implementation to keep in lockstep. Realistic cost: 1-2 weeks plus permanent 2x maintenance. Meanwhile **ffmpeg's dshow path is already written** in `deviceList.ts`/`nativeCapture.ts`. **Defer Windows native helper indefinitely**; if a Windows customer appears, ship them the existing ffmpeg/dshow path first. Zero impact on the macOS ship.

## 7. Fallback strategy

Recommend **3-tier: Swift helper → ffmpeg → Chromium getUserMedia**, NOT replacement. Reasons:
- The native→browser fallback machinery already exists in `useAudioStream.ts`; adding one more rung reuses the pattern.
- ffmpeg is the only Windows story and the only Linux-someday story.
- The IPC contract (`audio:nativePcmChunk` ArrayBuffers + level + error channels) is **capture-source-agnostic** — a Swift helper can emit the *same* channels from `electron/ipc/audio.ts`, meaning the renderer needs zero changes. This is the single most important architectural finding: Tier 3 is a main-process-only swap behind an existing interface.
- The v0.1.80 code (backoff, stderr classification, channel probe, picker UI, prefs) is sunk cost in the good sense — keep it as the proven fallback.

## 8. Sequencing recommendation — THE decision

**Recommendation: (a) — field-test ffmpeg first. DEFER Tier 3.**

Reasoning:
1. **v0.1.80 is untested against the actual failure.** The hypothesis is that Chromium's getUserMedia was the broken layer and CoreAudio-via-ffmpeg works (OBS/Logic evidence supports this). If true, Tier 3's core justification evaporates. If false — e.g. avfoundation *also* fails on the SQ-5's 32-ch stream — that failure mode is exactly the data you need to design the Swift helper correctly (HAL IOProc vs AVAudioEngine, channel-map handling). Building Tier 3 now means designing blind.
2. **Every genuine Swift advantage except latency has a cheap TS mitigation:** stable IDs → resolve stored device by *name* at capture start (small patch to `nativeCapture.resolveDeviceLabel` + `nativeDeviceStore`, which already stores `name`); hot-plug → re-enumerate on the existing restart backoff. The remaining deltas (30-100ms latency, 25-70MB binary) don't move verse-detection UX.
3. **Both paths are equally blocked on Apple signing.** The helper doesn't ship "more properly" than ffmpeg until the Developer ID cert exists. Getting the cert + notarization pipeline is higher-leverage than the helper itself.
4. Parallel-building (b) violates the project's own loop standard: you'd be building a replacement for a component whose review/field cycle hasn't closed.

**Trigger conditions to un-defer (GO criteria for Tier 3):** field test shows ffmpeg avfoundation also silent/glitchy on the SQ-5; OR device-index instability causes real operator incidents that the name-resolution patch can't fix; OR sustained CPU/battery complaints from the ffmpeg subprocess; OR product needs <50ms monitoring features. Until one fires: **NO-GO on building, GO on field-testing v0.1.80.**

Recommended pre-work regardless (cheap, high value):
1. Persist + resolve native device by **name/UID, not index** (TS-only).
2. Switch native-path WS framing from base64-JSON to **binary frames** (bridge already handles binary? verify — `scripts/audio-server.ts` message union at line 394 is JSON-typed, so this needs a small bridge change).
3. Start the **Apple Developer signing/notarization** track now — it gates every future distribution improvement, Tier 3 included.
