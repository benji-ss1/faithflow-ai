# NDI video output (native sender) — build spec & status

**Goal (2026-08-28 full spec):** PresentFlow itself becomes a genuine NDI® network source
(official SDK) so an OBS+DistroAV broadcast PC on the same LAN discovers `PresentFlow - NDI 1`
and receives the LIVE lyrics/graphics with alpha — replacing ProPresenter at JPD. NOT window
capture, NOT screen share, NOT a virtual camera. See the 25-section spec the user supplied.

## Build phases & status
| Phase | Deliverable | State |
|---|---|---|
| 1 | **NDI output render surface** `/ndi` (fixed 1920×1080, live-only, transparent/full modes, alpha **test pattern** §6/§18). Reuses SlideRenderer/OutputSlide — no second renderer. | ✅ SHIPPED (main @5e8dee8) |
| 2 | **NDIService** (§24 API) + **Settings → Output → NDI** UI (§17) + status (§19) | ✅ WRITTEN, typecheck-clean (main @01f0f30) |
| 3 | **Offscreen capture**: hidden `BrowserWindow{offscreen,transparent,1920×1080}` loads `/ndi`, `paint`→`toBitmap()` BGRA→un-premultiply→native send (§3,9,10). In Electron MAIN. | ✅ WRITTEN, typecheck-clean |
| 4 | **Native NDI send addon** (N-API vs official SDK v6.3.2.0). BGRA, discovery, keep-broadcasting-at-0-receivers (§11,19), video-only (§13). | ✅ **COMPILES + electron-rebuilds** (arm64) against the real SDK (main @62343f9) |
| 5 | **Signed DMG + two-computer OBS/DistroAV acceptance test** (§20,23,25) | ☐ TODO — on-site, church media team |

**What is verified vs not (honest, §25):** Phases 1–4 are code-complete and typecheck-clean;
the native addon **compiles, links against libndi, and electron-rebuilds** for Electron 43
(arm64). NOT yet verified: that frames actually reach OBS with correct alpha, discovery on the
church LAN, long-service stability — all need the DMG built + the two-computer on-site test.

## How to build the DMG with NDI (on a Mac with the NDI SDK installed)
1. Install the **NDI SDK for Apple** (`/Library/NDI SDK for Apple`) — already present on this machine (v6.3.2.0).
2. `npm run electron:build` (or `:signed`) — this now runs `ndi:rebuild` first (vendors the SDK to a
   no-space path, `electron-rebuild`s the addon), then packages. If the SDK is missing the DMG still
   builds; NDI just shows "runtime not loaded" (§2).
3. **arch note:** the addon is built **arm64** (this Mac). The `--x64` slice of the universal DMG will
   NOT have a working NDI addon unless the addon is also cross-built for x64. Church Macs are Apple
   Silicon → arm64 is fine; drop `--x64` or cross-build if an Intel Mac is a target.
4. **Signing/notarization:** the `.node` + `libndi.dylib` must be signed under hardened runtime for a
   distributable build (current DMGs are ad-hoc/unsigned — see `docs/DMG_RELEASE_SOP.md`).
5. **Reliable alpha:** if the OBS overlay shows a black box instead of transparency, the Electron
   offscreen GPU path is flattening alpha — add `app.disableHardwareAcceleration()` at startup
   (software OSR) and rebuild. Decide this during the on-site test (§6).
6. **NDI® attribution** (§1 license): add "NDI® is a registered trademark of Vizrt NDI AB" to About —
   confirm with the license before public release ("confirm with an expert, never final").

## On-site acceptance test (§20, §23, §25) — the real completion gate
Computer A (Mac): PresentFlow → Settings → Output → NDI → turn ON → **Test NDI Output**.
Computer B (Windows, same LAN): OBS + DistroAV → Sources → NDI Source → pick `PresentFlow - NDI 1`.
Confirm: source appears; test pattern shows with alpha (transparent bg keys through); change the
LIVE slide → OBS updates; change PREVIEW only → OBS does NOT change; Clear → OBS shows camera.

**ARCHITECTURE CORRECTION vs the 2026-08-27 draft below:** the spec forbids window/screen
capture (§22 #1,#5), so the sender must **OFFSCREEN-RENDER the live-output canvas** (Phase 3),
NOT ScreenCaptureKit the visible window. Everything else in the draft (un-premultiply, DistroAV
Normal-latency, signing, NDI® attribution) still holds.

**VERIFICATION REALITY (honest, per §25):** Phases 1–2 are typecheck/browser-verifiable here.
Phases 3–5 are NOT — they need the app running, the NDI SDK on a build machine, and two
computers + OBS/DistroAV on a LAN. Native NDI code cannot be hot-deployed (Vercel) — it needs a
signed/notarized DMG. Do **not** mark NDI "done" until the §20 two-computer test passes on-site.

**NDIService API to implement (§24):** `initialize() · start() · stop() · updateFrame(bgra,w,h) ·
setSourceName() · setResolution() · setFrameRate() · setOutputMode('transparent'|'full') ·
getStatus() · shutdown()`. NDI networking stays OUT of the render components.

---

## (Original 2026-08-27 design — architecture research, still largely valid)

**Author:** synthesized from a 3-agent investigation (codebase map + native-pipeline research +
strategy). Where a claim is version-sensitive or unverifiable without NDI hardware, it is
flagged — do **not** treat those as final.

---

## 1. Why NDI at all (and when NOT to)

Phase 1 already solves the common case: OBS loads `/livestream?bg=transparent&pair=CODE`
as a Browser Source and alpha-composites lyrics over the camera. That covers **~90% of
churches** (single PC running both PresentFlow and OBS) with zero native code.

NDI earns its keep only when one of these is physically true:

| Use NDI when… | Why Browser Source can't |
|---|---|
| Lyrics run on **machine A**, streaming/switching on **machine B** | Browser Source must load on the streaming PC. NDI carries the alpha overlay across the LAN. **Strongest case.** |
| Switcher is **vMix / TriCaster / Wirecast** (not OBS) | No Browser Source exists there; NDI is the native layer input. |
| Church already runs **NDI cameras / PTZ / hardware** on a wired production network | PresentFlow drops into an existing NDI graph. |
| Multiple synchronized outputs (program + lower-third + vertical) from one source | One NDI sender, many subscribers. |

**Stay on Browser Source** for single-PC OBS, non-technical volunteers, cross-platform, or
anything on a deadline. NDI is the advanced/pro fast-follow, never the critical path for a
given Sunday. Keep Browser Source configured as the one-click rollback.

---

## 2. What already exists (codebase reality)

Confirmed by inventory across `faithflow-bible`, `faithflow-ai`, and
`presentflow/presentflow-electron`:

**PRESENT and reusable:**
- **Swift native NDI helper** (`native/macos/Sources/PresentFlowAudioHelper/`): `NDIRuntime.swift`
  dlopens `libndi.dylib` and resolves `NDIlib_v5_load()` — **the returned function table already
  exposes every send function** (`NDIlib_send_create`, `NDIlib_send_send_video_v2`, …), not just
  the receive calls currently used. `NDIDiscovery.swift` does mDNS/LAN find.
- **Bundled universal `libndi.dylib`** (x86_64 + arm64, ad-hoc signed) at
  `resources/native/macos/libndi.dylib`, already shipped into the `.app` via
  `mac.extraResources`.
- **Committed NDI SDK headers** including `Processing.NDI.Send.h` — present in
  `presentflow-electron/native/macos/.../CNDI/include/`. In `faithflow-bible` these are
  **gitignored** (license-gated) and materialize when `build.sh` runs against an installed SDK.
- **The transparent render surface is done** (Phase 1, this repo):
  `src/app/livestream/page.tsx` `?bg=transparent` + `SlideRenderer` `transparentBg` +
  `OBS_OVERLAY_TEXT_SHADOW`. This is *exactly* the alpha frame NDI would send.
- **A transparent output BrowserWindow already exists**: `electron/windows/OutputWindow.ts`
  spawns a `transparent: true`, `backgroundColor: "#00000000"`, `backgroundThrottling:false`
  window for the "Livestream" role on a secondary display (today: for OBS screen-capture).
- Build/sign/package pipeline (`build.sh` universal lipo + ad-hoc sign; `hardenedRuntime:true`;
  `NSCameraUsageDescription`; entitlements) — adding a native sender is incremental.

**MISSING (the actual work):**
1. All NDI **send** code (no `NDIlib_send_create` / video-frame construction anywhere — the
   helper is `NDIlib_recv_bandwidth_audio_only`, i.e. audio *receive*).
2. A **BGRA-with-alpha frame source**. There is **no Electron offscreen rendering** (`offscreen:true`
   / `paint` / `getBitmap` appear nowhere). Nothing grabs the transparent surface's pixels
   in-process today — OBS captures it externally.
3. **Frame transport** to the sender. The helper's current channel is a stdio PCM pipe (fine for
   audio); 1080p BGRA is ~500 MB/s and needs a different transport.
4. A **UI toggle** to enable/name the NDI output.

**Environment corrections to earlier assumptions:**
- Electron is **43.1.0** (not 38.x). Re-validate OSR alpha on this exact major.
- `rse/grandiose` bundles **NDI SDK 5.0.0, not 6**, and its **send API is undocumented**
  ("To follow" in the README) — so it is *not* a safe drop-in.

---

## 3. Recommended architecture — three frame-source options, ranked

The frame **grab** is the crux. The lyrics render inside Chromium, so the pixels must come from
either Chromium (Electron) or a macOS window capture of the already-transparent output window.

### Option A ⭐ (recommended): Swift ScreenCaptureKit → existing Swift NDI sender — all native
- Reuse `OutputWindow.ts`'s existing **transparent Livestream window** as the source.
- In the Swift helper, add `NDIVideoSender.swift`: capture *that window* with **ScreenCaptureKit**
  (`SCStreamConfiguration` with `pixelFormat = BGRA`, `backgroundColor = .clear`,
  `capturesShadowsOnly=false`) to get per-window **BGRA frames with a real alpha channel**, then
  push via `NDIlib_send_send_video_v2` using the **already-loaded** function table.
- **Why it wins:** reuses the proven native runtime/dylib/headers/signing pipeline; **no Electron
  offscreen rendering** (dodges the #1 risk); **no high-bandwidth video IPC** (SCK → NDI stays
  inside the Swift process); the transparent window already exists.
- **Risks:** SCK single-window alpha fidelity must be spiked (SCK composites; confirm transparent
  regions come back `A=0`, not black); the window must be capturable (can live on a secondary/virtual
  display); macOS-only.

### Option B: Electron offscreen `paint` → getBitmap (Node) → sender
- Hidden `BrowserWindow({ webPreferences:{ offscreen:true, paintWhenInitiallyHidden:true },
  transparent:true, backgroundColor:'#00000000' })` on the transparent URL; consume `paint` →
  `image.getBitmap()` (BGRA). Requires `app.disableHardwareAcceleration()` (software OSR is the
  only reliable-alpha path — GPU OSR flattens/mangles alpha).
- Then either (b1) send via a Node NDI addon (`grandiose` — **unproven send**, adds `electron-rebuild`
  + a second signed `.node`), or (b2) ship BGRA frames to the Swift sender over a **shared-memory /
  local-socket** transport (new, ~500 MB/s).
- **Why not primary:** Electron 43 OSR alpha fidelity is the single biggest unknown, and it forces
  software compositing process-wide; grandiose send is undocumented.
- **Why keep it:** it's the **cross-platform** path (Windows/Linux later), where SCK doesn't exist.

### Option C: Electron `capturePage()` polling → getBitmap → sender
- Poll `webContents.capturePage()` on the transparent window at N fps → `getBitmap()` BGRA.
- Simpler than OSR, no `disableHardwareAcceleration`, but capturePage alpha fidelity is also
  unverified and polling is less efficient than event-driven `paint`. Fallback of a fallback.

**Decision:** build **Option A** for macOS (matches the existing macOS-only NDI scope), keep
**Option B** documented as the cross-platform future. Both feed the same NDI frame contract (§4).

---

## 4. The NDI frame contract (identical whichever grab is used)

`NDIlib_video_frame_v2_t`:
- `FourCC = NDIlib_FourCC_type_BGRA` (32-bit **straight**-alpha BGRA — the widely-supported alpha
  FourCC).
- `xres/yres` = 1920/1080 (or the dynamic selection, §6).
- `frame_rate_N/D` = `30/1` default (`30000/1001` for 29.97 houses; 60 optional).
- `picture_aspect_ratio` = `16.0/9.0` (set explicitly).
- `frame_format_type = progressive`.
- `line_stride_in_bytes = xres*4`.
- `timecode = synthesize`.

**⚠️ Un-premultiply is mandatory.** Both Electron's offscreen bitmap **and** SCK output are
**premultiplied** alpha; NDI/OBS expect **straight** alpha. Sending premultiplied darkens the
drop-shadow into black halos. Per pixel with `a>0`: `C = min(255, round(C*255/a))` for B,G,R;
leave `a`; where `a==0` keep RGB 0. Optimize with a `255/a` reciprocal LUT and **only recompute
on content change** (see §5), not every frame.

---

## 5. Performance — throttle to content, not wall-clock

Lyrics are static 99% of the time (they change on slide advance). So:
- Grab at a modest rate (**30 fps default**; 60 optional). 1080p BGRA = 8.3 MB/frame.
- Keep a single "current processed BGRA buffer"; recompute the un-premultiply **only when the frame
  actually changed** (Electron `paint` gives a `dirtyRect`; SCK gives frame callbacks — dedupe by
  hashing or a dirty flag). Re-send the last buffer on a steady cadence so NDI receivers stay locked
  (some drop an idle source).
- Un-premultiply in native code (Swift/SIMD sub-ms) or via LUT — never a naive per-frame JS divide
  over 2M px. Reuse ping-pong buffers; no per-frame allocation.
- Net: CPU ≈ idle while a slide is held, brief spike on transition — perfect for this workload.

---

## 6. "Dynamic" — what it should mean (priority order)

1. **(A) Live-following content — MUST.** The overlay re-renders instantly on every slide change.
   Already true via the `presentflow-live` BroadcastChannel + Supabase pair-code Realtime that the
   transparent surface subscribes to. NDI must capture the live surface, not a snapshot.
2. **(B) Selectable resolution / aspect — HIGH VALUE, helps everyone.** 720/1080/4K and 16:9 vs 9:16
   (vertical re-lays-out the lyric safe-area, not just letterbox). Shared output config read by both
   the Browser-Source URL (`?w=&h=&aspect=`) and the NDI sender.
3. **(C) Configurable / multiple named NDI sources — NDI-only, phased.** e.g. `PresentFlow — <church>
   (Program)` full-frame alpha, plus a later `… (Lower Third)` band-only source. Names configurable
   (church/machine) so multi-machine setups don't collide in the NDI picker.

---

## 7. Receiver alpha matrix (verify on the church's actual versions)

| Receiver | Alpha? | Notes |
|---|---|---|
| **OBS + DistroAV** | Yes | **Latency = Normal is mandatory** — Low/Lowest → black box (issues #937/#983). Straight alpha sidesteps the premultiply bug (#899). Place source above the camera. |
| **vMix** | Yes | Use as overlay/key with alpha; verify per version. |
| **TriCaster** | In principle | Alpha handling varies by model/generation → **verify on-site**. |
| **Resolume** | Yes | Alpha-native compositor; blend mode matters. |
| **Wirecast** | Uncertain | Historically inconsistent → may need fill+key. **Don't promise; test.** |

**Fallback ladder when a receiver won't key alpha:** (1) fill+key dual source, (2) premultiplied
toggle, (3) solid-colour chroma key, (4) fall back to Browser Source (if the receiver is OBS anyway).

---

## 8. Packaging / signing / legal

- **Native additions ride the existing pipeline:** add `NDIVideoSender.swift` to `build.sh`'s
  `swiftc`/SwiftPM target and the SDK Send header resolves via the existing header copy. `libndi.dylib`
  already ships via `mac.extraResources`.
- **Signing/notarization becomes non-optional.** The native `.node`/dylib must be `asarUnpack`'d and
  signed under hardened runtime; the current builds are `identity:null` (ad-hoc/unsigned, arm64 gap).
  NDI forces fixing this — see `docs/DMG_RELEASE_SOP.md`.
- **NDI® license:** the runtime is redistributable but requires a **visible "NDI®" attribution** and
  compliance with the NDI SDK License. `build.sh`/`docs/NDI_AUDIO.md` already note this for the audio
  feature; an output feature needs the attribution surfaced in-app. **Legal wording = confirm with an
  expert, never claim final** (Frontier legal rule).

---

## 9. Test plan that needs NO NDI hardware

- **(a) Transparent render** — load the transparent URL over a colored backdrop in a browser, cycle
  slides; confirm crisp text, full see-through, instant live updates, and each resolution/aspect param.
  *(Already verified for Phase 1.)*
- **(b) Alpha correctness — the key gate** — dump one grabbed frame (SCK or offscreen `paint`) to a
  **PNG with alpha** and inspect pixels: transparent regions must be `A=0` (not black `A=255`), text
  edges `0<A<255`. Also check premultiplied-vs-straight to predict fringing. This catches "we're
  actually sending opaque black" before any NDI hardware exists.
- **(c) NDI-send smoke test** — free **NDI Tools**: run the sender, open **NDI Studio Monitor** on the
  same machine (source discoverable + correctly named + updates on slide change); bring the source into
  **local OBS + DistroAV** over a test image to exercise the real alpha path on one dev box.
- **(d) Requires a real rig (flag "untested — verify on-site"):** multi-machine NDI over the church LAN
  (mDNS/discovery/bandwidth), vMix/TriCaster/Wirecast alpha on their versions, PTZ coexistence, sustained
  2-hour-service stability.

Ship when (a)(b)(c) are green; label (d) pending on-site.

---

## 10. Operator UX (one panel)

**"Livestream Output"** in the desktop app:
- **Default: Browser Source (recommended)** — read-only URL + Copy button; resolution + aspect dropdowns
  rewrite URL params; inline OBS steps; note "use this if PresentFlow and OBS are on the same computer."
- **NDI Output (advanced) — off by default** — Source name (pre-filled church/machine), resolution/aspect
  (shared), later an "also emit Lower-Third source" checkbox. Guardrail copy right in the panel:
  *"In OBS add an NDI Source (DistroAV), set **Latency = Normal** (not Lowest — it shows black), drag it
  above your camera."* + a "switch back to Browser Source" escape hatch.

---

## 11. Repo decision & sequencing

- **Build in `faithflow-bible`** (newest, v0.1.322, has the transparent surface). Its NDI headers are
  gitignored but `build.sh` materializes `Processing.NDI.Send.h` from the installed SDK; port the
  committed-header/Swift-sender additions from `presentflow-electron`. Reconcile the two shells.
- **~2-week sequence:**
  - **Day 1:** alpha-fidelity spike — SCK single-window BGRA alpha (Option A) *and* an Electron OSR
    `paint`→PNG check (Option B), pick the primary from real pixel dumps (§9b). Read the NDI Send header
    to lock the sender call shape.
  - **Days 2–4:** `NDIVideoSender.swift` (create/send_video_v2, BGRA, un-premultiply) + SCK capture of the
    transparent window + a start/stop IPC toggle; dirty-frame cadence.
  - **Days 5–6:** signing/notarization of the native bits + universal build; NDI® attribution in-app.
  - **Days 7–8:** hardware validation (OBS/DistroAV Normal-latency; vMix if available); operator docs;
    changelog entry; DMG per SOP.
  - **Buffer:** legal attribution review; cross-platform (Option B) scoping.

---

## 12. Ranked risks

1. **[HIGH] Alpha fidelity of the grab** (SCK window capture *or* Electron 43 OSR) — if transparent
   comes back opaque/black, the feature is dead. → Day-1 PNG-dump spike, both options, before committing.
2. **[HIGH] Sender maturity** — build the Swift sender on the existing runtime table (proven) rather than
   grandiose (undocumented send, NDI 5.0.0). Fallback: thin path either way is small.
3. **[MED] DistroAV Normal-latency + premultiply** (#937/#983/#899) — mostly operator-config; send straight
   alpha + ship the exact receive settings + troubleshooting.
4. **[MED] Signing/notarization** of native bits under hardened runtime (current builds unsigned).
5. **[MED] NDI® license attribution** — surface in-app; legal review, do not claim final.
6. **[MED] Frame transport** (only if Option B) — ~500 MB/s BGRA needs shared-mem/socket, not the stdio pipe.
   Option A avoids this entirely.
7. **[LOW] Windows/Linux** — no native sender path; transparent windows unreliable on Linux (documented in
   `OutputWindow.ts`). Browser Source covers non-mac until Option B.
