# PresentFlow Decoupling Plan — "Layers, not slides"

**Source:** Advisory session with TO (RTÉ-level technical operator, ProPresenter power user), 2026-09-07.
**Mandate:** "Right now what you have is PowerPoint, not ProPresenter. Everything is live. Everything is layers (CapCut model). Nothing is stuck as one whole." These are MVP blockers for pro operators, not roadmap items — TO cannot use PresentFlow at Open Circle today because of them.

## TO's requirements, distilled

1. **Decoupled visual layers, live.** Background, lyrics/text, camera/video feed, slide media are independent layers, each swappable/removable/replaceable *while live* without touching the others. "Change the image right now — what happens to the slide? Nothing."
2. **Decoupled audio, in-app routing.** The app must configure audio sources AND destinations itself, independent of system-default audio — "send the video and audio to any location from the app." Mirror the video input/output architecture ("it's the same thing in reverse").
3. **Lower-third is a layer position, not an option/mode.** "It's just a slide you put at the bottom of the screen." Any content, any band, composed over anything else (e.g. camera feed + lyrics band simultaneously).
4. **Small composable actions → macros for free.** Everything the operator does becomes small serializable actions; grouping them to fire simultaneously gives ProPresenter-style macros without building "macros" as a feature.
5. **Systems thinking + telemetry.** Ship usage/crash telemetry home; watch what churches actually use; double down there. (Sentry + PostHog already wired — extend, don't add.)
6. **Reliability IS the MVP + easy switch.** "It has to work every time." Onboarding from ProPresenter/VideoPsalms must be simple and clear for volunteers.

## Current state (from architecture audit, 2026-09-07)

- Wire contract: `src/lib/broadcast.ts` — one monolithic `OutputState` snapshot re-broadcast wholesale; no per-layer identity/order/opacity/enable on the wire.
- Compositing & precedence rules (camera-wins, black-bg-suppresses-theme, etc.) hardcoded inline and **duplicated with drift** across `live/page.tsx`, `stage/page.tsx`, `livestream/page.tsx`, `ndi/page.tsx`.
- `sendSlideToLive` (`OperatorConsole.tsx:949`) is a god choke point fusing transport + transition policy + identity-skip + scripture styling; AI policy piled on top in `ProOperatorShell`.
- Audio: capture-only (getUserMedia/native helper → Fly bridge → Deepgram). **No audio output routing anywhere** (`setSinkId` unused). `native/ndi-sender` exists as a potential outbound A/V path.
- Closest action primitives: `CommandVerb` in `command-parser.ts` + `presentflow:*` CustomEvent bus.

## Invariants (never break — see memory + CLAUDE.md)

- BroadcastChannel same-machine path is primary and zero-latency; Realtime/LAN are additive.
- Projector validates everything inbound (`sanitizeOutputState` et al.) — keep hardening on every new wire shape.
- Transition-once idempotent guard, already-live skip, camera-wins guard, theme/template mutual exclusivity.
- No regression on currently-working Sunday paths; every phase behind additive code + explicit projector-test sign-off before merge.

## Phases (each: build on branch → six-agent gate → dummy-app verify → projector test → sign-off → merge)

### Phase 1 — Extract the compositor (pure refactor, behavior-identical)
One shared `<OutputCompositor state={OutputState} mode={live|stage|livestream|ndi}>` in `src/components/live/OutputCompositor.tsx` that owns the layer stack, z-order, and ALL precedence rules, consumed by all four routes. Kills the 4-way duplication and creates the single seam every later phase plugs into. Golden-output tests: for a matrix of `OutputState` fixtures, rendered layer stack must equal today's per-route behavior exactly.

### Phase 2 — Layer model on the wire (additive)
Add `layers?: LayerWire[]` to `OutputState` (stable `id`, `kind` (background|camera|slide|band|announcement|timer|message|media), `z`, `enabled`, `opacity`, `zone` (full|lowerThird|custom band), `transportScope` (local|all), per-kind payload). Old fields remain authoritative until a church opts in (`layersV2` flag); a pure `outputStateToLayers()` adapter derives layers from legacy state so the compositor renders one model. New `LiveMessage` type `layer-patch` for single-layer updates (swap background without resending the world). Extend validators/sanitizers.

### Phase 3 — Operator layer panel (the "CapCut" moment)
Layers strip in the Pro shell: see the live stack, toggle/swap/reorder each layer independently while live. Swap background without touching the slide; put lyrics in a band over camera; blank one layer, not everything. Lower-third becomes a per-layer `zone`, superseding the special-cased `scriptureLayout`/`obsLowerThird` paths (kept as adapters).

### Phase 4 — Action primitives (macros for free)
Serializable `OperatorAction` union (send-slide, patch-layer, set-background, clear, blank, logo, media-control, …) with one dispatcher; `sendSlideToLive` and the `presentflow:*` events become emitters/consumers of actions. Then `ActionGroup` = named list fired atomically = macros. AI and voice commands emit the same actions (no new auto-fire policy — suggest-only defaults preserved).

### Phase 5 — Audio routing (mirror of video I/O)
a) **Output device selection**: audio-out picker per destination using `setSinkId`/`selectAudioOutput` (media slide audio → chosen device, not system default). b) **Destinations as routes**: extend the existing input architecture (deviceCategorization, ChannelStrip, native helper) with an output table; NDI audio send via `native/ndi-sender` as a destination. c) Video audio follows its layer, not the machine. Native work rides the existing Swift/napi-rs helpers; Windows compile/test caveat applies (see NDI-receive memory).

### Phase 6 — Telemetry + switch path
PostHog events on layer/action usage (which layers, which actions, auto vs manual); Sentry breadcrumbs from the action dispatcher (every crash tells you the action history — Benji's "why did it break"). Onboarding: importers already exist (OpenLyrics/PPTX/PDF); add a "coming from ProPresenter/VideoSams" guided switch flow to the onboarding rebuild epic.

## Sequencing rationale
1 is zero-risk and unblocks everything. 2–3 deliver TO's core "can I use this live" test. 4 is small once 2–3 exist and is what makes macros/AI/voice converge. 5 is the other hard MVP blocker but is independent of 1–4, can run in parallel once 1 lands. 6 is continuous.

## Phase 2 — as built (2026-09-08)

Phase 2 landed as an ADDITIVE, DORMANT layer model on the wire — zero behaviour change on the legacy Sunday paths (the compositor still renders from the legacy OutputState fields; `NEXT_PUBLIC_LAYERS_V2` is off and nothing reads the derived stack yet).

- **`LayerWire` discriminated union** (`src/lib/broadcast.ts`), discriminated on `kind` — `background | camera | slide | media | band | announcement | timer | message | logo`. Each payload reuses the EXISTING hardened validator for its type; unknown/invalid layers are DROPPED, never passed through. Common base carries `id` (safe token, `[A-Za-z0-9_-]{1,64}`), `z`, `enabled`, optional `opacity`, `zone`, `transportScope` ("local" | "all") and `bgTransparent`.
- **`MAX_LAYERS = 16`** — the array is capped on the strict validator, the fail-open `sanitizeLayers`, AND the per-route `layer-patch` override maps (a hostile same-channel sender can update existing ids but cannot grow the map past the cap with new ids).
- **Duplicate ids**: `sanitizeLayers` drops subsequent duplicates (first wins); the strict array validator rejects any array with duplicate ids. Ids are the operator-panel / layer-patch / React-key identity.
- **`layer-patch` LiveMessage** — swap/patch a single layer without resending the whole OutputState. Receivers store it into a per-route override map (dormant; gated behind `NEXT_PUBLIC_LAYERS_V2` for Phase 3 consumption).
- **`/ndi` coerce fix (BEHAVIOURAL — must be named in the projector sign-off)**: `/ndi` now uses `coerceLiveMessage` (fail-open field-by-field salvage) like `/live` + `/livestream`, so a single bad neighbour field from a legacy/out-of-date sender salvages instead of blanking the NDI surface (was: strict `isValidLiveMessage`, which rejected the whole snapshot). This is the ONE behavioural change in Phase 2 and must be called out in the projector sign-off.
- **Adapter coverage** (`outputStateToLayers`, `src/lib/output-layers.ts`) — derives the `LayerWire[]` stack from legacy fields and is agreement-locked against `planOutput()` per mode/transparent: background enable (camera-wins + transparent-suppresses), camera present (stage-disabled), slide always-on, **`logo`** (theme-logo, z=20, enabled iff plan enables theme-logo), **`bgTransparent`** on the slide iff plan resolves over-video, and lower-third zone. Second arg `opts?: { mode?: "live"|"stage"|"livestream"|"ndi"; transparent?: boolean }` (defaults live).
- **`transportScope` enforced at the fan-out choke point**: `scrubOutputStateForRemote(state)` (pure helper in `broadcast.ts`) is the single seam for the local-vs-remote rule — it nulls `videoInput` (preserving the legacy inline scrub EXACTLY) and drops `transportScope:"local"` layers before Realtime/LAN publish, while BroadcastChannel (same-machine) keeps them. Used by all three Realtime/LAN publish sites in `OperatorConsole.tsx`. Inert today (layers never populated).
- **Per-church opt-in decision**: `NEXT_PUBLIC_LAYERS_V2` stays a GLOBAL kill-switch. Phase 3's render swap will gate on BOTH the env flag AND a per-church, DB-backed `layersV2` church-settings boolean. The DB field is deliberately NOT built in Phase 2 (documented in `output-layers.ts`).
- **`"audio"` kind RESERVED for Phase 5** (audio routing) — deliberately NOT in the union yet; a wire carrying `kind:"audio"` today is an unknown future kind → dropped by `sanitizeLayers`, rejected by the strict validator (forward-compat contract, test-locked).

Tests: `test/layer-wire.test.ts` (22), `test/output-layers.test.ts` (12).

## Definition of done (TO's bar)
An operator can, mid-service, with content live: change the background only; swap the camera feed only; move lyrics to a lower-third band over video; replace a slide's media without a flash; route media audio to a chosen output — each in one action, nothing else on screen flinching. Then: TO runs a service at Open Circle on it.
