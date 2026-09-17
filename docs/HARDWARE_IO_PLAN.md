# PresentFlow Hardware I/O Plan: USB, Blackmagic and Audio Interfaces (Mac + Windows)

Status: **PLAN, awaiting sign-off.** No code has been changed. Written 2026-09-16.
Sources: 8 parallel research agents (code map, Blackmagic devices, the Blackmagic developer kit, audio interfaces, USB video, open-source repos, competitors, repo rules and packaging).
Anything marked **UNVERIFIED** could not be confirmed against a primary source. It must be proven on hardware before we depend on it.

---

## 0. Scope correction (user, 2026-09-16): **AUDIO FIRST**
The priority is **audio in over USB**: a USB cable from a Blackmagic device (ATEM Mini, UltraStudio/DeckLink embedded audio) or any audio interface or mixer (X32/XR18, A&H SQ/Qu, Focusrite, Behringer, PreSonus, Yamaha TF) into PresentFlow, so the AI and mic board get clean, correct channels on Mac and Windows. Camera and video work is secondary.

**The build order is now: Phase 2 (audio) FIRST, then Blackmagic audio (below), then video/output phases.**

Where Blackmagic audio comes from:
- **ATEM Mini / Web Presenter over USB:** appears as a standard USB audio input device (UAC, no driver), usually 2 channels of program audio. [Eastwood FAQ](https://www.eastwoodsoundandvision.com/magazine/blackmagic-design-atem-mini-pro-frequently-asked-questions/), [DPReview](https://www.dpreview.com/news/9734950903/blackmagic-design-web-presenter/). It's handled by the audio tier with DSP OFF. **Test first.**
- **UltraStudio / DeckLink (SDI/HDMI embedded audio, up to 16 channels):**
  - The audio arrives inside the video signal. The guaranteed cross-platform way to read it is the Blackmagic developer kit's audio input (`EnableAudioInput`, per the [SDK manual](https://documents.blackmagicdesign.com/UserManuals/DeckLinkSDKManual.pdf)). So Phase 3 starts with **audio-only capture** from Blackmagic, feeding the same `onPcmChunk` path, before any video.
  - Whether Desktop Video also exposes these channels as a normal system audio device on macOS/Windows is **UNVERIFIED**. Test on hardware; if it does, the RtAudio tier covers it for free.

Revised order:
1. **Audio Phase A:** renderer fix, DSP off for interfaces/mixers + correct channel picking (Vercel)
2. **Audio Phase B:** native RtAudio tier: true channel counts, any channel as vocal, WASAPI/ASIO on Windows (DMG + installer)
3. **Audio Phase C:** Blackmagic embedded-audio capture via the developer kit (DMG + installer)
4. Then the video input, Blackmagic output (key/fill) and NDI-on-Windows phases below.

---

## 1. Summary

**"USB to Blackmagic doesn't work" is really three separate problems:**

| # | Problem | Root cause | Fix type | Ships via |
|---|---|---|---|---|
| A | USB webcam-class capture (ATEM Mini, Web Presenter, Cam Link, Magewell, HDMI dongles) shows black, low resolution or "couldn't start" | Our code (§3): no resolution/fps request, one device opened separately by 3 windows, device ID goes stale, no camera permission request | Renderer + a tiny Electron change | Vercel + small DMG/installer |
| B | Blackmagic **UltraStudio / DeckLink / Intensity** input and **SDI/HDMI output with key+fill** | We have no Blackmagic code at all. These are not webcam-class devices; they need Blackmagic's Desktop Video driver and developer kit | New native module | DMG + Windows installer |
| C | Multichannel **audio interfaces** (X32/XR18, A&H SQ, Focusrite, Behringer) give 1–2 channels or the wrong channel | Echo cancellation / noise suppression / auto gain forced on (mono squash); Chromium only delivers 2 channels; Windows native capture never reads channel counts and has no ASIO | Renderer fix + native module (RtAudio) | Vercel + DMG/installer |

We build them in that order: cheapest and most certain first, riskiest last. Every phase can be switched off by flag and rolled back.

---

## 2. Research facts, with sources

### 2.1 Blackmagic devices fall into two classes
- **Act like a USB webcam, no driver needed:**
  - **ATEM Mini** family: USB-C webcam out. [techspecs](https://www.blackmagicdesign.com/products/atemmini/techspecs), [Manchester Video](https://www.manchestervideo.com/2020/06/24/impossible-features-of-the-blackmagic-design-atem-mini-and-mini-pro/)
  - **Web Presenter**: "standard UVC and UAC compatible… you don't need any drivers". [DPReview](https://www.dpreview.com/news/9734950903/blackmagic-design-web-presenter/)
  - Pocket 6K cameras in webcam mode. [DIYPhotography](https://www.diyphotography.net/blackmagic-adds-webcam-mode-and-more-to-pocket-cameras-with-camera-8-6-beta/)
  - → Chromium `getUserMedia` can open these. **So if they fail today, the fault is in our code.**
- **Need the Desktop Video driver:**
  - **UltraStudio / DeckLink / Intensity** are not webcam-class devices. [UltraStudio software](https://www.blackmagicdesign.com/products/ultrastudio/software), [DeckLink software](https://www.blackmagicdesign.com/products/decklink/software)
  - **UltraStudio Monitor 3G is output-only.** It can never be an input. [Newsshooter](https://www.newsshooter.com/2026/07/07/blackmagic-design-ultrastudio-express-3g/)
- **macOS rules:**
  - From macOS 12.3, old-style camera plugins are deprecated in favour of Camera Extensions. [WWDC22](https://developer.apple.com/videos/play/wwdc2022/10022/)
  - From Sonoma 14.1, cameras without Camera Extensions are blocked. [Apple 108387](https://support.apple.com/en-us/108387), [Eclectic Light](https://eclecticlight.co/2023/10/27/how-sonoma-14-1-could-stop-your-camera-working/)
  - Desktop Video **14.3+** ships Camera Extensions. [No Film School](https://nofilmschool.com/blackmagic-desktop-video-14-3)
  - Whether Chromium sees UltraStudio through them is **UNVERIFIED**.
- **Windows:** Desktop Video installs the "Blackmagic WDM Capture" driver, so these devices can appear as a camera. The same card also shows up twice (legacy "DeckLink Video Capture" + WDM). [alax.info](https://alax.info/blog/1568), [EasyWorship forum](https://support.easyworship.com/support/discussions/topics/24000013128)

### 2.2 What competitors require (we copy these one-for-one)
- **ProPresenter 7:**
  - Requires Desktop Video **14.3+**.
  - On macOS you must allow the Driver Extensions and Camera Extensions, and approve "System Extension Blocked". [RV: Updating Desktop Video on macOS](https://support.renewedvision.com/hc/en-us/articles/43976720114323-Updating-Blackmagic-Desktop-Video-on-macOS)
- **Alpha key** needs a keyer card: UltraStudio 4K, DeckLink 4K Extreme, Duo 2, Quad 2 or 8K Pro. [RV supported devices](https://support.renewedvision.com/hc/en-us/articles/360011598133-ProPresenter-Supported-Blackmagic-devices)
  - Key and fill connectors must be paired in Desktop Video Setup.
  - Key types: Premultiplied / Straight / None.
  - [RV alpha key](https://support.renewedvision.com/hc/en-us/articles/360041408314-Setting-up-an-Alpha-Key-output-from-ProPresenter), [Trinity (Duo 2)](https://www.trinitydigitalmedia.com/2020/11/06/how-to-send-an-alpha-channel-from-propresenter-7-with-a-bmd-decklink-duo2-card/)
- **"If Media Express can't see it, ProPresenter can't either."** This is their standard triage step. [RV Media Express](https://support.renewedvision.com/hc/en-us/articles/9782663835539-Using-Blackmagic-Media-Express-to-Troubleshoot-SDI-Output)
- **vMix:** a blank screen is almost always a format mismatch, e.g. 59.94 vs 60 or 29.97 vs 30. The fallback is RGB32. [vMix KB](https://www.vmix.com/knowledgebase/article.aspx/35/why-do-i-see-a-blank-screen-or-error-when-using-a-blackmagic-card)
  - Key/fill modes: None / Straight / Premultiplied. [vMix KeyFill](https://www.vmix.com/help23/KeyFill.html)
  - After Desktop Video 14.3, some inputs only showed as the legacy Windows capture driver. [vMix forum](https://forums.vmix.com/posts/t32648-Issue-Decklink-Duo-2-and-desktop-video-14-3--only-legacy-wdm-input-vmix)
- **OBS:** the Blackmagic source uses the developer kit, and the mode must match the signal. [OBS KB](https://obsproject.com/kb/video-capture-sources)
- **Gap:** none of these vendors documents a signal-present badge or hot-plug support. Building both gives us an edge over ProPresenter.

### 2.3 USB video in Chromium/Electron
- **Mac permissions:**
  - Hardened-runtime apps need `com.apple.security.device.camera`, or access is denied silently. [electron-builder#5364](https://github.com/electron-userland/electron-builder/issues/5364)
  - We already have that entitlement.
- **Permission prompt:** `systemPreferences.askForMediaAccess('camera')` shows the macOS prompt. Once the user denies it, macOS never asks again, so the app must deep-link to System Settings. [electron#37581](https://github.com/electron/electron/issues/37581), [BigBinary](https://www.bigbinary.com/blog/request-camera-micophone-permission-electron)
- **Device busy:** a device held by another app throws `NotReadableError` (older Chrome: `TrackStartError`). [addpipe](https://blog.addpipe.com/common-getusermedia-errors/)
- **Opening one device twice** at different frame rates is a known Chromium bug. [crbug 41112679](https://issues.chromium.org/issues/41112679)
- **Frame-rate and slowness regressions:** [crbug 40250353](https://issues.chromium.org/issues/40250353), [crbug 414842421](https://issues.chromium.org/issues/414842421)
- **Chromium outputs 4:2:0 frames**, not 4:4:4. [media-dev](https://groups.google.com/a/chromium.org/g/media-dev/c/qFmr-Y62ePI)
- **Latency:** ProPresenter's live video measured about 200 ms end to end (2017). That is our latency target to beat. [Trinity](https://www.trinitydigitalmedia.com/2017/11/07/propresenter-tutorial-how-much-latency-does-the-live-feature-add-propresenter-show/)

### 2.4 Audio interfaces
- **Chromium's multichannel limit:** the long-open issue "Support multichannel input from audio device via getUserMedia()" says getUserMedia hands over a summed stereo signal. [issues.chromium.org/40403559](https://issues.chromium.org/issues/40403559)
  - Its current open/closed status is **UNVERIFIED**.
- **True stereo** needs echoCancellation, noiseSuppression and autoGainControl all turned **off**. Otherwise both channels carry the same mono signal. [addpipe stereo](https://blog.addpipe.com/recording-true-stereo-audio-using-getusermedia/)
- **`channelCount:1` takes only input 1**, so a mic on input 3 is silent. [amical#165](https://github.com/amicalhq/amical/issues/165)
- **Native libraries:**
  - **RtAudio**: maintained, supports CoreAudio / WASAPI / ASIO. [thestk/rtaudio](https://github.com/thestk/rtaudio)
  - **audify**: RtAudio wrapper for Node. [almoghamdani/audify](https://github.com/almoghamdani/audify) (Electron support beyond v22 **UNVERIFIED**)
  - **naudiodon**: its README says it is for development and prototypes; last updated 2024. [Streampunk/naudiodon](https://github.com/Streampunk/naudiodon)

### 2.5 Blackmagic developer kit and existing repos
- **Developer kit:** the DeckLink SDK comes free from the [Blackmagic developer page](https://www.blackmagicdesign.com/developer/products/capture-and-playback/sdk-and-software). Manual: [SDK manual PDF](https://documents.blackmagicdesign.com/UserManuals/DeckLinkSDKManual.pdf).
  - The API file is under a permissive notice, which is why open-source projects vendor it (see [macadam/decklink](https://github.com/Streampunk/macadam/tree/master/decklink)).
  - The SDK download itself is under Blackmagic's licence agreement → **confirm with an expert before shipping.**
- **Runtime:** our code loads the user's installed Desktop Video driver (`/Library/Frameworks/DeckLinkAPI.framework` on Mac, the driver's components on Windows). **We never bundle the driver.**
- **Existing repos:**

| Repo | License | Last activity | Use |
|---|---|---|---|
| [Streampunk/macadam](https://github.com/Streampunk/macadam) | Apache-2.0 | patched 2026-05-22 | Only Node binding for the Blackmagic kit, with keying. Stale code; an Electron 21+ "external buffers" issue was reported in 2024. **Reference / fork-source** |
| [stagetimerio/grandiose](https://github.com/stagetimerio/grandiose) | Apache-2.0 | 2026-04 | Maintained NDI 6 send+receive, mac arm64/x64 + win x64 — **fixes NDI output on Windows** |
| [tux-tn/grandi](https://github.com/tux-tn/grandi) | Apache-2.0 | 2026-07 | NDI alternative |
| [obsproject/obs-studio](https://github.com/obsproject/obs-studio) decklink plugin | GPL-2.0 | active | **Read only for design; never copy** (GPL) |
| [CasparCG/server](https://github.com/CasparCG/server) | GPL-3.0 | active | Key/fill design reference; no macOS; don't embed |
| [streamlabs/obs-studio-node](https://github.com/streamlabs/obs-studio-node) | GPL-2.0 | active | Too heavy + GPL; skip |
| FFmpeg `-f decklink` | nonfree | — | Legally can't ship inside the app ([ref](https://mark.himsley.org/FFmpeg/using_decklink_devices.html)); skip |

---

## 3. What is broken in our code today (from reading it, not tested on hardware)

1. [LiveVideoLayer.tsx:41-47](../src/components/live/LiveVideoLayer.tsx) and [VideoInputPanel.tsx:121](../src/components/operator/pro/left/VideoInputPanel.tsx) request the device with **no width/height/frameRate**. Chromium then picks a low default mode.
2. **Projector, Stage and Livestream each open the same device separately.** Single-reader capture cards fail on the second window.
3. [electron/main.ts:597-608](../electron/main.ts) **only asks for microphone permission**, never camera. The build is ad-hoc signed (`identity: null`), so the macOS permission prompt may never appear.
4. **The saved video deviceId goes stale** after a replug or on another machine. There is no fallback that matches by device name.
5. **DSP is forced on** at [multiChannelCapture.ts:147-149](../src/lib/audio/multiChannelCapture.ts) and [voice-commands.ts:163-165](../src/lib/voice-commands.ts), which squashes input to mono.
6. **Windows** [deviceList.ts:156-168](../electron/audio/deviceList.ts) never fills in `channelCount`, so the mic board and channel grid never show. The ffmpeg Windows capture path (`dshow`) sees only 2-channel devices and matches names fragilely.
7. **macOS channel counts** come from fuzzy `system_profiler` name matching. The device index shifts when virtual devices (NDI / BlackHole / Loopback) are added or removed.
8. **No Blackmagic code exists anywhere.** Windows has no NDI sender.
9. **The CI release workflows never build native modules** (`ndi:rebuild` is not in `release-desktop.yml` / `release-windows.yml`). Installers built by CI ship without NDI.

---

## 4. The plan

**Architecture** (follows MVP spec §1314 "OutputAdapter"): one **Device Hub** service in Electron main that owns every hardware handle, with pluggable providers:

```
Renderer UI (device picker, signal badges, setup checklist)
        │  IPC (typed, validated)
Electron main ── DeviceHub
   ├─ UvcProvider        (Chromium getUserMedia — renderer-owned, hub tracks state)
   ├─ DeckLinkProvider   (native addon in a utilityProcess — capture + output + keyer)
   ├─ NdiProvider        (existing NDI output + grandiose on Windows)
   └─ AudioProvider      (existing Swift/ffmpeg tiers + new RtAudio tier: CoreAudio/WASAPI/ASIO)
```
Why a separate utility process for native code: a driver crash can't take down the operator window, and it sidesteps the Electron external-buffer ban that affects macadam.

### Phase 0: Safety net (no user-visible change)
- Create a dedicated worktree `feat/hardware-io` off `origin/main`. We never touch the shared main checkout, because 9 other sessions are active.
- Add `ndi:rebuild` (and later the new addon builds) to both CI release workflows, and pin `@electron/rebuild`.
- Record the current production deployment ID and the current DMG version as rollback points.

### Phase 1: USB webcam-class video that works (renderer-first, lowest risk)
1. **One shared capture per device.**
   - The operator window owns the stream.
   - Output windows receive frames through a single owner rather than opening the device again.
   - Option (a): keep a single `getUserMedia` in the projector window, with the others mirroring over a same-machine MediaStream relay.
   - Option (b): each output opens the device only if it isn't single-reader.
   - Pick after a hardware test; default to (a).
2. **Constraints:** `deviceId:{exact}` plus `width/height/frameRate: {ideal: 1920/1080/60}`.
   - On `OverconstrainedError`, retry with looser constraints.
   - Show the negotiated `getSettings()` result ("1920×1080 @ 59.94") in the picker.
3. **Device ID stability:** match by deviceId, fall back to label+groupId, and re-send the choice to outputs on `devicechange`.
4. **Errors with clear messages:**
   - `NotReadableError` → "In use by another app (OBS/Zoom/Teams). Close it and retry."
   - `NotAllowedError` → a deep link to Camera permission.
   - Empty feed → a format-mismatch hint (59.94 vs 60).
5. **Signal badge + hot-plug:** listen for track `ended`/`mute` and `devicechange`, and re-acquire automatically.
6. **Electron:**
   - `askForMediaAccess('camera')` on first use of a video input.
   - `setPermissionCheckHandler` so device labels populate.
   - IPC to read camera permission status.
- Ships via Vercel, plus one small Electron change (the permission call) in the next DMG/installer.

### Phase 2: Audio interfaces
1. **Renderer (Vercel):**
   - When the source is an interface or mixer (not a laptop mic), set `echoCancellation/noiseSuppression/autoGainControl:false`.
   - Keep DSP ON for built-in laptop mics, so existing mic users don't regress.
   - Mic mode picks a channel pair rather than forcing `channelCount:1`.
2. **Native RtAudio tier** (new, alongside Swift/ffmpeg; nothing removed):
   - Enumerate the true channel count and sample rate.
   - Open N channels at 48 kHz.
   - Choose any channel as the vocal feed.
   - Windows: WASAPI by default, ASIO optional.
   - Feed the existing `onPcmChunk` path, so the AI pipeline is untouched.
   - Pick devices by name + channel count, not by index.
   - Prototype on audify first; if it doesn't build on our Electron version, write a thin binding of our own over RtAudio.
3. **Live-console safety (Sarah rules):** never probe devices while AI listening is on, and ask before any device change while live.

### Phase 3: Blackmagic native module (DeckLink / UltraStudio)
1. `native/decklink/`, our own N-API addon (Apache-2.0 macadam and the SDK manual as reference; **no GPL code copied**).
   - Built for darwin-arm64, darwin-x64 and win-x64.
   - It links against the user-installed Desktop Video driver at runtime.
2. **Detection:**
   - Desktop Video missing or below 14.3 → a clear "Install Desktop Video 14.3+" card with the download link, plus the macOS extension checklist (§2.2).
   - The app never crashes if the driver is absent (same pattern as the NDI fallback).
3. **Capture:**
   - Enumerate inputs and **auto-detect the format** (`VideoInputFormatChanged`), with a manual mode fallback.
   - Frames go into the same video-input layer as USB.
   - On Windows, hide the duplicate WDM/DirectShow entries for cards handled natively.
4. **Output (the big one):**
   - Offscreen render of the `/live` output → BGRA → scheduled playback on the chosen SDI/HDMI port.
   - **Key+fill:** where the card supports keying (capability table from RV's list), offer Premultiplied (default) / Straight / None and External vs Internal key.
   - Warn that the connectors must be paired in Desktop Video Setup.
5. **Triage built into the app:** "Open Blackmagic Media Express. If it can't see the signal, it's the driver/cable, not PresentFlow."

### Phase 4: NDI parity on Windows
- Replace or augment our Mac-only NDI sender with `@stagetimerio/grandiose`, so Windows gets NDI output too, including NDI alpha.
- This is also the **low-cost key/fill route** for churches without a keyer card.
- Keep the existing Mac sender until the new one is proven. No removal without sign-off.

### Phase 5: Unified Inputs/Outputs UI (PP7-style)
- **One grouped device list:** USB · Blackmagic · NDI · Audio. Each device shows a name, preview toggle, detected format, signal light and a "Test" button.
- **Empty, loading and error states** for everything.
- Built to the design system, 44px targets, WCAG AA.

---

## 5. What YOU need to install or buy

| What | Where | Needed for | Mac | Windows |
|---|---|---|---|---|
| **Blackmagic Desktop Video 14.3+** (free) | https://www.blackmagicdesign.com/support (search "Desktop Video") | UltraStudio/DeckLink/Intensity in or out | Yes, then allow Driver + Camera Extensions in System Settings, then reboot | Yes, then reboot |
| **Blackmagic Desktop Video SDK** (free, registration) | https://www.blackmagicdesign.com/developer/products/capture-and-playback/sdk-and-software | **Building** Phase 3 (dev machines + CI only, not end users) | Yes (build Mac) | Yes (build Windows) |
| **NDI SDK 6** (free) | https://ndi.video/for-developers/ndi-sdk/ | Building NDI (Phase 4) | Already used | Yes |
| **Xcode Command Line Tools** | `xcode-select --install` | Compiling native modules | Yes | — |
| **Visual Studio 2022 Build Tools** ("Desktop development with C++") + Python 3 | https://visualstudio.microsoft.com/visual-cpp-build-tools/ | Compiling native modules | — | Yes |
| ASIO driver for the interface (e.g. Focusrite/Behringer USB driver) | vendor site | Phase 2 ASIO option | — | Yes |
| **Nothing** | — | ATEM Mini / Web Presenter / Cam Link (Phase 1) | — | — |

**Test hardware needed** (it cannot be claimed as tested without it):
- For Phase 1: an ATEM Mini *or* any HDMI→USB dongle.
- For Phases 3/4: an UltraStudio Recorder 3G (input) + UltraStudio Monitor 3G or 4K Mini (output).
- Ideally a DeckLink Duo 2 or 8K Pro for key+fill.
- For Phase 2: an XR18/X32 or Focusrite 18i20.
- **One Windows 11 PC and one Apple Silicon Mac (macOS 14/15).**

**Recommended but not blocking:**
- Apple Developer ID ($99/yr), so the macOS camera and mic prompts and system extensions behave reliably.
- A Windows code-signing certificate.

---

## 6. No-regression list (what each phase could break, and how we check it)

| Phase | Could break | Verify |
|---|---|---|
| 1 | Existing webcam/video input on projector; Layers v2 bottom-layer order; output windows sync | Before/after on Mac + Windows: pick device → live on projector/stage/livestream → clear F-key; OBS overlay editor untouched |
| 2 | **AI listening on laptop mics** (DSP change), Swift/ffmpeg tiers, Sarah wizard, mic board | Laptop-mic transcription A/B; existing SQ/native path unchanged; audio tests `ai-pipeline`, `service-mode` green |
| 3 | App launch on machines without Desktop Video; DMG size; signing | Launch on clean Mac/Win with no driver → no crash, feature hidden; utility-process crash → operator window survives |
| 4 | Mac NDI output | Existing Mac sender kept; A/B receiver in NDI Studio Monitor |
| all | Other sessions' work | Separate worktree, merge `main` in before ship, explicit-path commits, preview → desktop check → main |

Gate per phase: **6–9 review agents** (reviewer, security, stress, no-regression vs prod, end-to-end flow, design/UX, + native/packaging reviewer for 3–4), findings 🔴/🟡/🟢, a checkpoint block, and a What's New note. Everything ships behind a per-church flag first.

## 7. Open decisions for you
1. **Order:** Phase 1 → 2 → 3 → 4 as proposed? (Alternative: put Phase 4 NDI-on-Windows before Blackmagic, because it's cheaper and gives key/fill via converters.)
2. **Scope:** the MVP spec deferred DeckLink until after the MVP ([PROPRESENTER_MVP_SPEC.md:783](PROPRESENTER_MVP_SPEC.md)). Confirm we're pulling it in now.
3. **Hardware:** which of the test devices in §5 do you or Victor actually have?
4. **Licensing:** OK to get a quick expert check of the Blackmagic SDK licence before Phase 3 ships?
