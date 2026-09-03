# NDI Audio Receive (PresentFlow → AI pipeline)

**Goal (Christ Embassy field request, 2026-09-03):** let PresentFlow receive the
mixer audio over the network from an NDI source (OBS + DistroAV on a streaming PC),
instead of a physical USB cable from the mixer — so the broadcast PC keeps the USB
interface while PresentFlow gets the same feed over the LAN. **Receive-only** (no
NDI output). Discovery/selection modelled on OBS/DistroAV.

> STATUS: **code-complete, UNVERIFIED.** It must be **compiled and tested on
> Windows** — it cannot be built or run from a Mac. See "Build on Windows" below.

## Architecture (how audio flows)

```
OBS + DistroAV (streaming PC)  ──NDI──▶  native/ndi-receiver (N-API addon, main process)
                                            │  NDIlib_find (discover) + NDIlib_recv (audio-only)
                                            ▼  interleaved int16 PCM @ source rate/channels
                                electron/ndi/NDIReceiveService.ts
                                            │  down-mix to mono + resample → 16 kHz
                                            ▼  webContents.send("ndiAudio:pcm" / ":level")
                                preload  electronAPI.ndiAudio.onPcmChunk / onLevel
                                            ▼
                          useAudioStream.ts  ("ndi" capture mode)
                                            │  same sendAudioChunk → Deepgram WS as USB
                                            ▼
                                     Fly bridge → Deepgram → detection
```

## Files

- `native/ndi-receiver/` — the N-API addon: `ndi_receiver.cc` (find + audio-only
  recv on a background thread → PCM via a ThreadSafeFunction), `binding.gyp`
  (mac + **win** conditions), `index.js` loader (win DLL path fix), `prepare-sdk.sh`
  (mac) / `prepare-sdk.ps1` (**win**).
- `electron/ndi/NDIReceiveService.ts` — loads the addon, `listSources`,
  `start(sourceName)`, down-mix + 16 kHz resample, forwards PCM/level to renderer.
- `electron/ipc/ndi-receive.ts` — IPC handlers (`ndiAudio:*`). Registered in
  `electron/main.ts` via `registerNdiReceiveIpc(() => mainWindow)`.
- `electron/preload.ts` — `electronAPI.ndiAudio` bridge.
- `src/lib/audio/captureMode.ts` — `"ndi"` effective mode + selected-source
  persistence (`readNdiAudioSource`/`writeNdiAudioSource`). NDI takes priority when
  a source is selected and the bridge is present (works on Windows, unlike native).
- `src/components/operator/useAudioStream.ts` — the `"ndi"` capture branch (mirrors
  the native branch: PCM → `sendAudioChunk`, level meter, guardian, fallback to
  browser on failure).
- `src/components/operator/pro/right/tabs/AudioTab.tsx` — the NDI source picker
  (auto-refreshing list + select, OBS-like), at the top of the Audio panel.

## Build on Windows (REQUIRED — cannot be done on a Mac)

Prereqs on the Windows build machine:
- **NDI 6 SDK** installed (default `C:\Program Files\NDI\NDI 6 SDK`).
- MSVC C++ build tools + Python (node-gyp prerequisites) — e.g. `npm i -g windows-build-tools` or the "Desktop development with C++" VS workload.
- The repo's node_modules installed (`npm install`).

Then:
```powershell
# builds native addons for the current Electron ABI, then the NSIS installer
npm run electron:build:win
```
`electron:build:win` now runs `ndi:rebuild:win` first, which:
1. vendors the SDK (`native/ndi-receiver/prepare-sdk.ps1` → copies Include, the
   `.lib`, and `Processing.NDI.Lib.x64.dll` into `ndi-sdk/`),
2. `electron-rebuild`s `ndi_receiver.node` against the app's Electron version.

electron-builder then bundles (see package.json `win.extraResources`):
- `native/ndi-receiver/build/Release/ndi_receiver.node`, `index.js`, `package.json`
- `Processing.NDI.Lib.x64.dll` **next to the .node** (build/Release) so the OS loader finds it.

If the SDK/toolchain is missing, the rebuild is **non-fatal** — the installer still
builds; NDI audio just stays unavailable (the picker won't appear).

## Verify on-site (two computers, same LAN)

1. Streaming PC: OBS → **Tools → DistroAV NDI Settings → Main Output ON**, and the
   OBS **audio mixer bars move** (mixer audio is in OBS).
2. Both PCs on the **same subnet** (`ipconfig` first three groups match; a `ping`
   between them replies — allow OBS + NDI through Windows Firewall).
3. Presentation PC (new build): Operator → Audio panel → **NDI network audio** →
   the OBS source appears in the list → **click it** (writes the source, restarts
   the pipeline onto the NDI path).
4. The VU meter moves when the church is loud; the pill shows **"NDI network active"**;
   turn **AI ON** → live transcript.
5. Windows: **"Let desktop apps access your microphone"** does NOT gate NDI PCM
   (it arrives via IPC, not getUserMedia) — but leave it on for the fallback path.

## Known limitations / caveats

- **Untested end-to-end** — the C++ addon, the resampler, and the on-site NDI
  handshake need real hardware to validate. Treat as beta until a service proves it.
- Resampling is streaming **linear interpolation** (adequate for 48 k→16 k speech
  ASR; not a brick-wall anti-alias filter).
- Discovery relies on NDI mDNS or `External Sources` IPs in NDI Access Manager;
  cross-subnet / guest-WiFi / client-isolation blocks it (a network issue, not the app).
- macOS also builds the addon (mirrors the sender), but the primary target is Windows.
- The picker currently lives in the **operator** Audio panel (pro right rail); the
  Settings→Audio tab could surface it too in a later pass.
