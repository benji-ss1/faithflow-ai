# USB Audio + Blackmagic Setup: What to Download, Step by Step

This guide covers getting a USB audio interface, a digital mixer or a Blackmagic device into PresentFlow's AI listening on **Mac and Windows**. Technical background is in `docs/HARDWARE_IO_PLAN.md`.

There are two audiences:
- **Part 1: church computers** (the machine that runs PresentFlow during service).
- **Part 2: build machines** (only the developer who compiles the desktop app).

---

## Part 1: Church computers (run PresentFlow)

### Quick check: what does your device need?

| Your device | Driver needed? | What to install |
|---|---|---|
| Behringer X32 / Midas M32 (USB card) | Mac: no. Windows: **yes** | 1C (Windows only) |
| Behringer XR18 / X Air | Mac: no. Windows: **yes** | 1C (Windows only) |
| Allen & Heath SQ / Qu / CQ / Avantis (USB) | Mac: no. Windows: **yes** | 1C (Windows only) |
| Focusrite Scarlett / Clarett | Mac: no. Windows: **yes** | 1C (Windows only) |
| Behringer UMC, PreSonus, MOTU, Yamaha TF, Soundcraft Ui | usually Windows only | 1C (Windows only) |
| **Blackmagic ATEM Mini / Mini Pro / ISO / Extreme** (USB-C) | **No** (standard USB audio) | Nothing. Plug in USB-C. |
| **Blackmagic Web Presenter** (USB) | **No** | Nothing |
| **Blackmagic UltraStudio** (Recorder 3G, 4K Mini) / **DeckLink** card / **Intensity** | **Yes**, on Mac and Windows | **1A** (+ **1B** on Mac) |
| Dante (via Dante Virtual Soundcard) | Yes | Audinate DVS (paid licence) |

### 1A. Blackmagic Desktop Video driver (UltraStudio / DeckLink / Intensity only), Mac and Windows
1. Go to **https://www.blackmagicdesign.com/support/**.
2. Under "Latest Downloads", filter **Capture and Playback** and pick your product family (e.g. *UltraStudio*).
3. Download **Desktop Video 14.3 or newer** for your OS (macOS or Windows). Blackmagic asks for name and email; registration is free.
   - PresentFlow requires 14.3+. It's the same minimum as ProPresenter ([Renewed Vision](https://support.renewedvision.com/hc/en-us/articles/43976720114323-Updating-Blackmagic-Desktop-Video-on-macOS)).
4. **Quit PresentFlow** and any other video app.
5. Run the installer and **restart the computer**.
6. Open **Blackmagic Desktop Video Setup**. Your device should be listed. If it isn't, check the cable or Thunderbolt port.
7. In Desktop Video Setup, open the device and check the **audio input** is set to embedded SDI or HDMI, matching what's plugged in.
8. **Test outside PresentFlow:** open **Blackmagic Media Express**, then *Log and Capture*. If you see and hear the signal there, PresentFlow can use it. If Media Express can't, the problem is the driver or cable, not PresentFlow.

### 1B. Mac only: allow Blackmagic's extensions (macOS 13 Ventura and newer)
After installing Desktop Video:
1. Open **System Settings → General → Login Items & Extensions**.
2. Under **Allow in the Background**, turn ON *Blackmagic Design Desktop Video* and *Blackmagic Design Inc.*
3. Scroll to **Extensions → Driver Extensions**, click ⓘ, and turn ON **Blackmagic Design**.
4. In the same list, open **Camera Extensions** and turn Blackmagic ON.
5. If you saw "System Extension Blocked": go to **System Settings → Privacy & Security**, scroll down, and click **Allow** next to Blackmagic Design.
6. **Restart the Mac.**
7. On older Apple Silicon Macs (pre-macOS 13), Blackmagic may ask you to lower security in Recovery mode. Follow Blackmagic's on-screen instructions.

### 1C. Windows only: your interface or mixer's ASIO driver
PresentFlow on Windows reads **every input channel** through ASIO. Without the vendor driver, Windows only shows 2 channels.

| Brand | Where | Download |
|---|---|---|
| Behringer X32 / M32 (X-USB card) | https://www.behringer.com/downloads.html → search the model | **X-USB ASIO driver** |
| Behringer XR18 / X Air | same site | **XR18 ASIO driver** (or the "Behringer USB Audio driver") |
| Behringer UMC series | same site → UMC model | **Behringer USB Audio Driver** |
| Allen & Heath SQ / Qu / CQ / Avantis | https://www.allen-heath.com/support/downloads/ → your console | **USB Audio Driver (Windows ASIO)** |
| Focusrite Scarlett / Clarett | https://downloads.focusrite.com → your product | **Focusrite Control 2** (includes the ASIO driver) |
| PreSonus StudioLive / Quantum | https://www.presonus.com/pages/downloads → Universal Control | **Universal Control** (includes the ASIO driver) |
| Yamaha TF / DM3 | https://usa.yamaha.com/support/ → Steinberg | **Yamaha Steinberg USB Driver** |
| Soundcraft Ui24R / Signature | https://www.soundcraft.com/en/support → product | **Soundcraft USB Audio ASIO driver** |
| MOTU | https://motu.com/download | **MOTU Pro Audio Installer** |
| Anything else | the maker's website | look for "ASIO driver" |

Steps:
1. Download the driver for your exact model.
2. Install it with the mixer **unplugged**, then **restart Windows**.
3. Plug the USB cable in, straight into the PC (not a hub).
4. Open the driver's control panel and set the **sample rate to 48 kHz**. PresentFlow resamples anything, but 48 kHz is the most reliable.
5. **Close** other apps that might hold the ASIO driver (DAWs, OBS with an ASIO plugin, the driver's own mixer app). ASIO allows only one app at a time.

### 1D. Mac and Windows: Allen & Heath / Behringer USB routing (the #1 "no sound" cause)
On the mixer itself, make sure the **pastor's mic (or a vocal/AI bus) is routed to a USB channel**:
- **X32 / M32:** Routing → Card Out → assign the vocal bus or channel to a card output.
- **XR18:** Routing → USB Sends → set a USB channel to the vocal channel or bus.
- **SQ:** I/O → USB B / Direct Outs → patch the vocal to a USB send.

### 1E. In PresentFlow
1. Plug the device in, then open PresentFlow **after** it's connected (Blackmagic in particular).
2. **Desktop app (recommended for mixers, interfaces and Blackmagic):**
   1. Open **Audio** and turn on **Pro audio driver (beta)**. This switch only appears in desktop builds that include it, and listening restarts automatically.
   2. Set **Capture mode** to **Native** (or leave it on Auto). On Windows the Native option only appears once the Pro audio driver is on.
   3. Pick your device. It shows its real channel count, e.g. "X32 (ASIO)  32ch". Blackmagic devices show as "… (Blackmagic SDI/HDMI audio)".
   4. Open **Mic Board** or **Auto-detect**, talk into the pastor's mic, and choose that channel.
   5. **ASIO note (Windows):** ASIO allows one stream at a time. Stop listening before opening the per-channel meters on an ASIO device.
3. **Browser capture / web app:** pick the interface, then tick **Separate channels from my mixer (USB)**. Listening restarts automatically. Set your gain on the mixer, because browser auto-gain is off in this mode.
4. **Mac, first time only:** allow **Microphone** when macOS asks (System Settings → Privacy & Security → Microphone → PresentFlow).
5. **If something goes wrong mid-service:** turn **Pro audio driver** off. PresentFlow goes straight back to standard capture.

---

## Part 2: Build machine (developer only, to compile the desktop app)

### Mac build machine
1. **Xcode Command Line Tools:** open Terminal and run `xcode-select --install`.
2. **Node.js 20 LTS:** https://nodejs.org (or `brew install node@20`).
3. **CMake** (only needed if audify ever has to compile from source): `brew install cmake`.
4. **Blackmagic Desktop Video SDK** (Blackmagic audio support):
   1. Go to https://www.blackmagicdesign.com/developer/products/capture-and-playback/sdk-and-software
   2. Click **Desktop Video SDK** (latest), register (free) and download.
   3. Unzip it to your home folder so this path exists: `~/Blackmagic DeckLink SDK/Mac/include/DeckLinkAPI.h`. If you put it elsewhere, set `export DECKLINK_SDK_DIR="/path/to/Blackmagic DeckLink SDK"`.
5. **NDI SDK** (existing NDI features): https://ndi.video/for-developers/ndi-sdk/ → *NDI SDK for Apple*, installed to `/Library/NDI SDK for Apple`.
6. Build: `npm ci && npm run electron:build`.
   - This runs `decklink:rebuild`, which prints `OK` or clearly says Blackmagic was skipped.

### Windows build machine
1. **Visual Studio 2022 Build Tools:** https://visualstudio.microsoft.com/visual-cpp-build-tools/
   - Tick **"Desktop development with C++"** (includes MSVC, the Windows SDK and `midl`).
2. **Python 3.11+:** https://www.python.org/downloads/ (tick "Add to PATH").
3. **Node.js 20 LTS:** https://nodejs.org
4. **Blackmagic Desktop Video SDK:** same download as the Mac steps. Unzip to `C:\Blackmagic DeckLink SDK` so `C:\Blackmagic DeckLink SDK\Win\include\DeckLinkAPI.idl` exists, or set `DECKLINK_SDK_DIR`.
5. **NDI 6 SDK** for Windows: https://ndi.video/for-developers/ndi-sdk/
6. Build from a **"x64 Native Tools Command Prompt for VS 2022"**, so `midl` is on PATH: `npm ci && npm run electron:build:win`.

### Licensing note
- The Blackmagic SDK is free, but its download is covered by Blackmagic's licence agreement.
- PresentFlow builds against the SDK headers and loads the **user-installed** Desktop Video driver at runtime; we never bundle the driver.
- **Confirm with an expert** that shipping the compiled addon complies with the current SDK licence before a public release.
- audify is MIT-licensed (https://github.com/almoghamdani/audify); RtAudio is MIT-style.

---

## Test hardware checklist (nothing is "tested" until it has been run on these)
- [ ] Windows 11 PC + X32/XR18 **or** SQ (ASIO, all channels, pick vocal channel, AI transcribes)
- [ ] Windows 11 PC + Focusrite (ASIO + WASAPI)
- [ ] Apple Silicon Mac (macOS 14/15) + the same interface (Swift tier unchanged; rtaudio fallback)
- [ ] ATEM Mini over USB-C on Mac + Windows
- [ ] UltraStudio Recorder 3G on Mac (Desktop Video 14.3+, extensions allowed): embedded SDI audio → AI
- [ ] DeckLink card on Windows: embedded audio → AI
- [ ] Unplug/replug mid-service: clear error, reselect works
