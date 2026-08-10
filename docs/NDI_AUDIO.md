# NDI network audio (receive)

PresentFlow can receive live service audio over the network via **NDI**, so the
mixer no longer needs a USB cable into the PresentFlow computer — the broadcast
machine keeps the USB audio interface while PresentFlow listens to the same feed
over the LAN. Reference behaviour: **OBS + DistroAV** (auto-discovered sources,
listed live, selectable).

Scope: **receive only** (no NDI output), **macOS only** (it lives in the Swift
capture helper). NDI sources appear in the normal audio picker just like a USB
device and feed the existing AI pipeline unchanged (16 kHz / mono / s16le PCM).

## Architecture (where NDI plugs in)

```
NDI sender (mixer / OBS / NDI Tools)  ──LAN(mDNS)──►  PresentFlowAudioHelper (Swift)
                                                        │  NDIDiscovery  (find sources)
                                                        │  NDIReceiver   (recv audio, →16k mono Int16)
                                                        ▼
   list-devices merges  ndi://<name>  ─►  swiftHelper.ts ─► renderer picker ─► WS bridge ─► Deepgram/Groq
```

- **NDIRuntime.swift** — dlopen()s `libndi.dylib` (bundled) and resolves
  `NDIlib_v5_load()`. No link-time dependency; absent runtime ⇒ NDI disabled,
  CoreAudio unaffected.
- **NDIDiscovery.swift** — long-lived `NDIlib_find` poll; emits `device-change`
  when the source set changes (live picker updates).
- **NDIReceiver.swift** — `NDIlib_recv` (audio-only bandwidth); converts NDI
  planar float → 16 kHz mono Int16 via `AVAudioConverter`, mirroring
  `AudioCapture.swift`. Same channel-select / gain / level / probe contract.
- **main.swift** — routes `start-capture` etc. by `ndi://` uid prefix; merges
  NDI sources into `list-devices` (`uid: ndi://<name>`, `transport: "ndi"`,
  `name: "NDI: <name>"`).
- **swiftHelper.ts** — spawns the helper with `--ndi-runtime <bundled dylib>`;
  `toNativeDevices()` preserves `transport` so the picker badges NDI.

## Prerequisites: get the NDI SDK (one-time)

The NDI SDK is free but **license-gated** (accept Vizrt's SDK license):
1. Download the **NDI SDK for Apple**: https://ndi.video/for-developers/ndi-sdk/
2. Install the pkg → lands at `/Library/NDI SDK for Apple/`
   (`include/` = headers, `lib/macOS/libndi.dylib` = universal runtime).

We **do not** commit the SDK headers or dylib. `native/macos/build.sh` copies:
- headers → `native/macos/Sources/CNDI/include/` (needed to compile `import CNDI`)
- `libndi.dylib` → `resources/native/macos/libndi.dylib` (bundled + ad-hoc signed)

Both are `.gitignore`d. Override the SDK location with `NDI_SDK_DIR=/path ./build.sh`.

### License obligation (bundling the runtime)
We bundle + redistribute the NDI runtime, so the app **must** show the NDI
attribution. It's rendered in the audio picker whenever an NDI source is present:
> NDI® is a registered trademark of Vizrt NDI AB.
Do not rename/obfuscate `libndi.dylib`.

## Build

```bash
cd native/macos && ./build.sh          # copies SDK headers+dylib, builds universal helper, ad-hoc signs
```
The `mac.extraResources` glob in `package.json` already ships everything under
`resources/native/macos/` (helper + `libndi.dylib`) into the `.app` — no
electron-builder change needed. Re-run `build.sh` before cutting a DMG (see
`docs/DMG_RELEASE_SOP.md`).

## Verify (end-to-end)

1. **Runtime loads**: launch the app; helper logs `NDI runtime loaded from … (vX)`.
   Missing dylib logs `NDI runtime not found … NDI sources disabled` and the app
   still works on USB/CoreAudio (graceful fallback — confirmed at helper level).
2. **Discovery**: on another LAN machine emit a source — **NDI Tools → Test
   Patterns**, OBS + DistroAV NDI output, or an NDI-enabled mixer. Open the audio
   picker (Settings › Audio): the source appears within ~1–2 s badged **NDI**,
   and appears/disappears live as the sender toggles.
3. **Capture**: select it → VU meter moves, channel-select + gain work, and words
   appear in the operator console — proving PCM reached Deepgram/Groq identically
   to USB.
4. **No-USB**: unplug USB, run on NDI only — the production scenario.
5. **DMG**: build a DMG, install on a clean Mac **without NDI Tools**, confirm NDI
   still works (proves the bundled runtime is self-sufficient).

## Manual smoke test of the helper (no app)

```bash
# With NDI absent — proves graceful degradation:
printf '%s\n%s\n' '{"cmd":"list-devices"}' '{"cmd":"quit"}' \
  | resources/native/macos/PresentFlowAudioHelper --ndi-runtime /nonexistent
# → logs "NDI sources disabled", still emits ready + the CoreAudio device list.

# With NDI present, a running sender should appear as {"uid":"ndi://<name>", "transport":"ndi", …}
```
