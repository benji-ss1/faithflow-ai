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

## ProPresenter parity mandate (2026-09-08)

**ProPresenter IS the MVP bar.** Full spec: `docs/PROPRESENTER_MVP_SPEC.md` (6-layer engine, Looks, Macros, arrangements, stage layouts, timers, <100ms click-to-live). The LayerWire kinds map onto its 6 layers (camera=VideoInput, background=Media, slide=Slide, announcement, band/logo≈Props, message=Messages; audio reserved). Phase respecs:

- **Phase 3 (layers panel)** now follows spec §22.1/§16/Ch8: per-layer clear buttons with lit "what's live" indicators (primary error-recovery dashboard), Clear-All guarded by 300ms hold, layer persistence (nothing auto-clears), lower-third as zone. Render-from-layers gated on per-church `layersV2` DB setting AND `NEXT_PUBLIC_LAYERS_V2`.
- **Phase 4 (actions)** = spec §21.2 Automation domain + §8 slide actions: `Action` union (media/audio/prop/look/stage_layout/macro/timer/clear_layer/clear_all), action badges on thumbnails, right-click inspect, direct test-fire. PresentFlow naming: Macros → **Automations**.
- **Phase 3.5/later — Scenes** (spec §2/§22.2, ProPresenter "Looks"): named [screen × layer] routing matrix + per-screen theme override, atomic switch, 5 pre-built Scenes. Prereq: layers render path live.
- **Phase 5 (audio)** adds the `audio` LayerKind (Audio Bin semantics: playlists, loop/stop/next, VU, independent clear) alongside device routing.
- Post-MVP tiers tracked in the spec's gap analysis (arrangements/Reflow parity already partially exist as song editor/import; Planning Center deep sync; MIDI).

## Phase 3 — as built (2026-09-08)

Phase 3 makes the projector RENDER from operator layer overrides (the "CapCut"
moment), gated on BOTH the global `NEXT_PUBLIC_LAYERS_V2` kill-switch AND a
per-church `layers_v2` opt-in column on `church_preferences`. With the flag off
(or a church not opted in) the operator emits NO overrides, the override arrays
stay empty, and the projector output is BYTE-IDENTICAL to the legacy path
(96-fixture flag-off plan-parity test-locked).

What shipped:

- **Render seam** `resolveLayeredInput` / `resolveLayeredPlan`
  (`src/lib/output-layers-render.ts`): applies id-keyed overrides to the legacy
  `PlanInput`, reusing ALL of `planOutput`'s proven precedence (camera-wins,
  transparent keying, stage-never-camera). No overrides ⇒ same object ⇒ same
  plan.
- **Operator store** `useLiveLayers` (`src/components/operator/`): derives the
  stack from the live OutputState, layers operator overrides on top, emits
  `layer-patch` on the same-machine BroadcastChannel, and folds overrides into
  the full OutputState heartbeat so remote/late-joining projectors converge.
- **Layers Panel** (`pro/right/LayersPanel.tsx`): per-layer clear + visibility +
  a lit "what's live" indicator (Ch8 error-recovery dashboard), background swap
  (reuses the Background Templates picker), slide zone (Full / Lower third), and
  a 300ms press-and-hold Clear All.

R1 re-arm decision (product): **zone overrides PERSIST across normal slide
sends** (lower-third mode sticks), but a stale `enabled=false` slide override is
cleared/re-enabled the moment a real new slide goes live (`useLiveLayers.
rearmSlide()`, called from `sendSlideToLive`) so a prior "hide/clear slide" can
never swallow the next slide. Slide zone/visibility patches carry NO payload
snapshot (`{id,kind,z,enabled,zone}` only) — the projector always renders the
CURRENT base slide in the chosen zone, so a stale slide can never stick.

**Wave 5A refinement (2026-09-08, user-directed field fix — supersedes the R1
re-arm rule above for the EYE-hide case):** the eye toggle is a NON-DESTRUCTIVE
visibility control that round-trips (HIDE = `enabled=false`, payload/store
untouched; SHOW restores exactly what was there); only the trash CLEAR is
destructive (resets the Background Template store). Two rules were in genuine
conflict — "hide persists across advances" (operator expectation) vs "a new send
re-arms a disabled slide" (R1b safety). **Chosen: EYE-hide persists across
advances; only a CLEAR-style block re-arms on send.** The store tracks which
layers were eye-hidden (`eyeHiddenRef`, store-local, never on the wire) and
`shouldRearmSlideOnSend` (pure, `src/lib/layer-store.ts`) skips a re-arm for an
eye-hidden slide while still re-arming a clear so it can't permanently swallow
output. Also fixed: the background reconcile effect used to blindly
`swapBackground(null)` when the base store reset to none (applying a theme with a
background calls `setActiveBackgroundId("none")`), which overwrote a HIDDEN
override's payload with null so SHOW restored nothing — the reported one-way
toggle. `reconcileBackgroundOnBaseChange` (pure) now leaves a hidden override
intact, follows a clear only while actively showing, and shows a real new pick.
The render resolver was hardened too: a re-enable carrying a null/undefined
payload falls back to the base content (`bg.payload != null`) instead of forcing
null. Tests: `test/layer-store.test.ts` (13), `test/output-layers-render.test.ts`
(+4 round-trip/clobber-proof). Renderer-only → Vercel. Changelog 0.1.389.

`/ndi` coerce fix (from Phase 2) + migration-first deploy order both still
apply: the migration
`docs/migrations/2026-09-08-add-church-preferences-layers-v2.sql` MUST be applied
BEFORE this code deploys (operate/operator pages `db.select()` list every schema
column); operate/page.tsx now ALSO wraps the read in try/catch → safe defaults
(defence in depth, mirrors (app)/operator).

### Accepted limitations (persistence + multi-operator are follow-ups)

- **Operator refresh drops overrides.** The override map is React memory-only
  (`useState`). A refresh mid-service → `overrides=[]` → the projector heartbeat
  clears its map → both sides converge to the derived base (NO desync), but the
  operator's manual layer edits (a hidden layer, a swapped background) are LOST.
  Persistence (DB/session) is a follow-up. *(Wave 2 hardened the CLEAR itself: a
  refreshed tab now carries a newer `layersEpoch` so its empty snapshot
  authoritatively clears the projector map — see Wave 2 below.)*
- **Two same-church operators clobber each other.** Each operator's OutputState
  heartbeat carries ONLY its own overrides and the projector REBUILDS (clear)
  from the latest snapshot, so two heartbeating operators alternately clobber
  each other's layer stack. Single-operator assumption — same class as the
  audio-bridge duel. Follow-up: merge or ownership.
- **Remote convergence is ~1s (heartbeat), not instant.** Same-machine
  BroadcastChannel `layer-patch` is instant; pair-Realtime / LAN-OBS projectors
  converge via the ~1s OutputState heartbeat snapshot (a `layer-patch` is a
  same-machine optimisation only, preserving the "BroadcastChannel primary,
  Realtime additive" invariant).
- **`layers_v2` is admin/SQL-only** for now: it is deliberately NOT settable via
  `updatePreferences` (explicit field whitelist), so the opt-in cannot be flipped
  by the settings UI until the enablement flow is built.

### Six-agent gate

The six-agent ship gate (reviewer / security / stress / build-standards / speed /
coherence) ran on this branch. This consolidated pass fixed all 🔴 (slide-
override staleness + re-arm, migration-order hardening, speed-reviewer's stable
hook identities + ClearAll unmount cleanup) and 🟡 findings (preferences
whitelist, no side-effects in state updaters, typed per-kind layer builder +
exhaustive `computeActive`, extracted `rebuildOverridesFromSnapshot`/
`applyLayerPatchBounded`, migration rollback comment, panel dead-code/header/copy
cleanups, always-present opacity wrapper in the layers path, ClearAll double-fire
guard + GPU fill, zone-toggle disable for non-text slides, per-layer accent
tokens, larger touch targets). Not yet field-verified on real projector hardware
— required before merge.

## Wave 2 — as built (2026-09-08)

A consolidated follow-up pass on `feat/decoupling-layers-panel` after a second
six-agent gate. Renderer-only → Vercel (no Fly, no DMG). Still not field-verified
on real projector hardware — required before merge.

### Panel + rail extraction / UI
- **VerticalClearRail + `layerMeta` + `ClearAllButton`** extracted from the
  monolithic panel into their own modules — the always-on right-edge "what's
  live" clear cues (one per layer, lit in the layer's accent colour, tap to clear
  that one layer) and the hold-to-confirm Clear-All are now reusable units.
- **Black-screen paint-order fix**: in the LAYERS_V2 compositor the per-layer
  absolute opacity wrapper flipped a cleared (`kind:"empty"`) slide ABOVE the
  background template, painting an opaque `bg-black` over it. The empty slide now
  renders transparent so an active Background Template shows through (golden DOM
  regression: `test/slide-renderer-empty.test.ts`).
- **Logo visibility-only patches + honest indicator**: a logo toggle/clear
  carries visibility only (never a url on the wire); the operator's live
  indicator lights only when a logo actually paints (`appearance.logoUrl` set +
  position ≠ "none"), read from the DERIVED base layer.
- **Base-background supersede**: changing the base Background Template while a
  background OVERRIDE exists emits a fresh-rev swap so the new pick shows and
  out-ranks the stale clear/hide override ("swap after clear shows nothing" fix).
- **Slide re-send / jump**: `rearmSlide()` drops a stale disabled slide override
  on a real new send (preserving a sticky lower-third zone).
- **LivePreviewPanel preview parity + frozen (Y3)**: the operator mini-preview
  renders through the SAME `OutputCompositor` path as `/live` (WYSIWYG under an
  override) AND now freezes its background layer (`previewFrozen` → BackgroundLayer
  `frozen`) so it no longer spins up a SECOND live RAF WebGL loop / video decode
  alongside the projector. Projector routes never pass the prop ⇒ unfrozen ⇒
  byte-identical live output (`test/output-compositor-frozen.test.ts`).

### Rev stamps + epoch (Y1) — corrected convergence contract
- **Monotonic `rev`** per layer patch (per-tab counter seeded at `Date.now()`):
  receivers keep the highest rev per id, so a lagging ~1Hz heartbeat or a ghost
  tab's snapshot can't regress a fresher incremental patch.
- **Rev sanity clamp + self-heal (Y1a)**: `isValidLayerWire` REJECTS a `rev` more
  than 24h (`REV_MAX_SKEW_MS`) in the future (a hostile `2^52` pin or a
  wrong-clock-year sender). Belt-and-suspenders, receivers SELF-HEAL: if a stored
  rev exceeds an incoming rev by more than that window it is treated as stale and
  the honest (lower) rev takes over WITHOUT a reload. Honest revs are unaffected.
- **Origin epoch (Y1b)** — the true fix for the refresh-clears invariant WITHOUT
  reopening ghost-clobber: each operator tab stamps its OutputState with
  `layersEpoch` (its immutable `Date.now` seed), present EVEN when overrides are
  empty. `rebuildOverridesFromSnapshot` compares it to the receiver's last-folded
  epoch: a NEWER epoch (a fresh operator tab) authoritatively clears+replaces the
  projector's override map even with empty overrides (restores "operator refresh
  clears the projector"); an OLDER epoch (a ghost tab) is IGNORED so it can't
  clobber; the SAME epoch keeps the rev-gated merge; a missing epoch (legacy
  sender) keeps the pre-epoch merge (tolerant). Threaded through all four output
  routes via a per-route `layerEpochRef`. Tests: `test/output-layers-convergence.
  ts` (epoch authority + self-heal), `test/layer-wire.test.ts` (validator clamps).
- **Corrected convergence contract**: same-machine BroadcastChannel `layer-patch`
  is instant; remote (pair-Realtime / LAN-OBS) projectors converge within ~1s via
  the OutputState heartbeat — now WITH the epoch/rev guarantees above, so a fresh
  tab wins and a ghost tab never clobbers. `useLiveLayers`'s header comment states
  the true guarantees incl. the fresh-tab-wins precondition.

### Other Wave 2 fixes
- **Library `?library=` UUID validation (Y2)**: `api/songs/list` + `api/media/list`
  now 400 on a non-`all`/`default`/UUID library param.
- **Service item-type union derived from the enum (Y4)**: `ServiceItemType =
  (typeof serviceItemTypeEnum.enumValues)[number]` in `schema.ts` replaces the 6
  hand-copied unions (actions/services/editor); header-case `(payload as any)`
  casts removed (plain `Record` access).
- **Legacy-shell header tolerance (Y5)**: the OperatorConsole preview nav walk is
  extracted to a pure `nextPreviewPosition` that SKIPS header items (`slides:[]`)
  in both directions — no more landing on a divider or a `slideIdx = -1`
  (`test/operator-nav.test.ts`).
- **Scripture band re-fit at high vScale (Y6)**: `refitScaledToBox` (pure) clamps
  the band's manually-scaled text back into the band box so a 200% "Text size"
  can't overflow; ≤ ~150% (when it fits) is unchanged
  (`test/scripture-lowerthird.test.ts`).
- **Delete confirms are Electron-safe (R1)**: `LibrarySection` (delete library) +
  `PlaylistSection` (delete-from-library) now use the in-app `useConfirm` dialog,
  not native `window.confirm` (the 0.1.381 desktop-freeze class).
- **Changelog 0.1.384 (Y7)**: honest clauses added — zone control applies to text
  slides; remote projectors converge within ~1s (same-machine instant).

### Phase 3.6 — Library / Playlist (as built)
- `libraries` table + `library_id` FK on songs/media; a `header` service-item type
  (colour-coded, non-projecting section divider); taxonomy/section accent colours;
  center Songs/Media browsers filter by the selected library ("All" / "Default" /
  named). Migration file added AND APPLIED to the local dev DB. **Prod ordering:
  migrate-first** — the migration must be applied BEFORE this code deploys (list
  reads select every schema column), same rule as the `layers_v2` column.

### Deferred (logged, not built)
- Drag content BETWEEN libraries (only right-click "Move to library" today).
- Per-item source-library badge in the "All" view.
- Rail undo-toast (undo a single-layer clear).
- MediaImageEditor file-wide design-token pass.
- glyph → lucide icon unification.
- ProPresenter red-slide hue note (match PP's exact section-divider red).

## Wave 3 — as built (2026-09-08)

Operator-app-only (all changes live in `src/components/operator/pro/*` — the
desktop Electron shell's hosted operator surface — plus shared server
actions/pure helpers; NOTHING in the marketing/dashboard/billing web routes).
Renderer-only → Vercel (no Fly, no DMG). Changelog 0.1.386. Not yet field-
verified on real projector hardware.

Cross-OS mandate honoured throughout: every new drag/drop path uses in-app
pointer/HTML5 events only (`dragover`/`dragleave`/`drop`, dnd-kit) — never OS-
native folder spring-loading — so behaviour is identical on Windows/macOS/Linux.
Escape cancels any in-flight spring-arm; Ctrl AND Cmd both covered where
shortcuts apply (the shared color/menu affordances are pointer-driven).

### Item 1 — Stale-action recovery UX
- **`src/lib/stale-action.ts`** (pure, tested): `isStaleServerActionError` matches
  ONLY the next-server-action version-mismatch class ("Failed to find Server
  Action …", "… was not found on the server", "… older or newer deployment"),
  reading `Error.message` AND `Error.digest`; never swallows generic
  network/action failures. `staleActionRecovery({contentIsLive})` = auto-reload
  iff nothing is live.
- Wired at the operator shell's existing global error net (`ProOperatorShell`
  `onRej`/`onErr`): a detected stale error is intercepted BEFORE the red toast.
  If `ctx.liveSlide.kind === "empty"` (nothing live) → `location.reload()`; if
  content IS live → a calm top banner ("PresentFlow updated — reload to
  continue") with a Reload button, and the projector is NEVER auto-touched.
  Confirmed against the real dev-log error strings (item 5). **Reload-loop guard
  (216cdfb):** the auto-reload fires at most ONCE — a sessionStorage sentinel is
  set before `location.reload()`, so a stale error that survives the reload (e.g.
  a still-mismatched deployment) does NOT spin the tab in a reload loop; it falls
  through to the banner instead. Tests: `test/stale-action.test.ts` (14).

### Item 2 — Section-header recolor discoverability
- Right-click recolor verified working; ALSO added a `⋮` kebab (Radix
  DropdownMenu) on every header row exposing Rename / Change color / Move Up-Down
  / Remove — same actions as right-click, discoverable for touch/Windows. Rename
  keeps its double-click too.

### Item 3 — Library rows feature parity
- (a) Rename already had double-click AND a context-menu item — verified, kept.
- (b) **Library colour label**: new dated migration
  `docs/migrations/2026-09-08-add-libraries-color.sql` (additive `color text`,
  idempotent, rollback + migrate-first note), APPLIED to local `faithflow`.
  Schema `libraries.color`; `setLibraryColor(id, color|null)` action (validated
  `#rrggbb` via the shared `isHex6Color`, null clears); rendered as a colour dot
  on the row + a "Change color" submenu (shared `SECTION_COLORS` palette + "No
  label"). `setHeaderColor` refactored onto the same shared validator (single
  source of truth, `src/lib/hex-color.ts`).
- (c) Playlist "+" → Blank confirmed present and working. **Library-side "Blank"
  DEFERRED** (documented, not bolted on): libraries hold songs/media only; a
  "blank presentation" is a service-item/playlist concept with no library-content
  data model, so a library-side Blank would be a fake. Deferred pending a real
  presentation-in-library model.

### Item 4 — Cross-OS spring-loaded drag & drop
- **`src/lib/spring-load.ts`** (pure, tested): `SPRING_ARM_MS=600`,
  `classifyDrop(types)` (library-item vs os-files vs none), a spring-arm reducer
  (`springEnter/Leave/Tick`, `isArmed` — different target restarts dwell, same
  target keeps arm, stale leave ignored), and playlist header drop-position
  resolution (`insertIndexAfterHeader`, `orderAfterHeaderDrop`). Timers wrapped
  in `useSpringLoad` (`left/useSpringLoad.ts`).
- (a) **Song/media → library row**: `LibrarySection` rows (incl. Default) are
  native drop targets; ~600ms hover arms (accent ring + `scale-[1.02]`); drop
  moves the dragged library item(s) via `setSongLibrary`/`setMediaLibrary`
  (same as "Move to library"), refreshing counts + center.
- (b) **Item → section header**: `SortableHeaderRow` is a native drop target;
  hover arms it; drop inserts the dragged item as the FIRST member of that
  section via the existing add path with `insertAtIndex = headerIdx+1`
  (`onAddLibraryItem`/`onAddMediaGroup` already accept an index). Flat-model note:
  sections don't collapse, so "spring-open" is realised as the arm cue + insert-
  into-section. **As built (post-1ca043c + Wave-3 fix pass):** `addServiceItem`
  always APPENDS, so the requested position is realised by an **append-then-
  reorder**: `repositionNewItem(newId, insertAtIndex)` snapshots the existing
  real-UUID order, then routes through the single pure ordering primitive
  `insertIdAtIndex(existingIds, newId, index)` (shared with `orderAfterHeaderDrop`
  — one clamp/insert behaviour, test-locked) and persists via `reorderServiceItems`
  (now a STATIC import — no cycle). **Fail-soft:** a non-finite/omitted index is a
  no-op (plain append preserved); an out-of-range index clamps into place; if the
  reorder call fails the item simply stays appended (never lost) and a warning is
  logged.
- (c) **OS file → library row**: an `os-files` drop routes through the EXISTING
  MediaImportWizard with the target library preselected, via a small in-memory
  `center/pendingImport.ts` bridge (files can't ride a URL): the rail stashes the
  files+libraryId, switches the center to media, and `MediaBrowser` consumes it
  on mount AND on event → opens the wizard pre-queued + pre-filed.
  `registerMediaAsset` gained an optional `libraryId` (ownership-validated;
  foreign/bad id falls back to Default rather than failing the upload); threaded
  through `uploadMediaFile` + the wizard's `initialFiles`/`initialLibraryId`.
- Tests: `test/spring-load.test.ts` (29 — incl. `insertIdAtIndex` clamp/relocate
  + `isRealDragLeave` child-boundary guard), `test/hex-color.test.ts` (3),
  `test/library-playlist.test.ts` (+2: colour round-trip, media library filing;
  needs a Postgres env).

### Wave-3 fix pass (2026-09-08, six-gate 🟡 remediation)
Applied after the six review gates (reds already fixed in 6921ef9 / 1ca043c /
216cdfb). All operator-app-only, renderer → Vercel:
- **One ordering source of truth**: `repositionNewItem` no longer reimplements
  clamp/insert — it routes through the pure `insertIdAtIndex` (also backs
  `orderAfterHeaderDrop`). `reorderServiceItems` + `insertIdAtIndex` made static
  imports (no cycle; `@/lib/actions` was already statically imported).
- **Dwell-restart guard**: `dragleave` onto a CHILD of a row/header no longer
  resets the 600ms dwell — the DOM wrappers call the pure `isRealDragLeave`
  (relatedTarget-contains check) before `spring.leave(...)`.
- **Escape owned by the hook**: the duplicated per-consumer window-keydown Escape
  effects were removed; `useSpringLoad` subscribes ONCE with stable deps (also
  fixes the re-subscribe-per-render speed 🟡). A subtle "Esc to cancel" caption
  now shows in the armed row/header affordance (tokens, no emoji).
- **Library-row kebab parity**: library rows gained the same `⋮` kebab (Rename /
  Change color / Delete) as header rows, so touch/Windows users aren't right-
  click-dependent.
- **Colour-menu dedup**: one shared `ColorSwatchItems` (`left/ColorSwatchMenu.tsx`)
  now backs all three colour menus (Library context menu + kebab, Playlist header
  kebab + context menu); literal `✓`/`▸` glyphs replaced with lucide
  `Check`/`ChevronRight`; kebab/menu hit targets bumped to ~28px.
- **Shared hex validator**: `addServiceItem`'s header-case inline regex switched
  to `isHex6Color`; `hex-color.ts` header comment rescoped (not a repo-wide
  unifier).
- **`registerMediaAsset` whitelist**: the `...rest` spread into `.values()`
  replaced with an explicit `{kind, fileName, s3Key, mimeType, sizeBytes}` field
  object (no behaviour change for legit callers).
- **0-byte import skip**: `enqueueFiles` skips empty files with an honest
  per-file toast (MIME magic-byte sniffing stays deferred — see below).

### Deferred (Wave-3 fix pass, logged not built)
- **MIME magic-byte sniffing** on import (content/extension mismatch): only the
  cheap 0-byte + size + type-whitelist checks are done client-side; deep sniffing
  is a server-side follow-up.

### Field-verify checklist (dwell feel — hardware pending)
Standing UX items that can only be judged on real hardware, moved here from the
build notes: does the 600ms arm dwell feel right on a slow/touch drag; does the
child-boundary guard fully eliminate flicker on a real trackpad; are the kebab
hit targets comfortable on a touch projector-side tablet. Not blockers; confirm
on the pilot projector.

### Item 5 — Dev overlay "issues"
- Read `/tmp/pf-dummy-dev.log` + the running :3005 app. The recurring overlay
  error class is EXACTLY the stale Server Action errors (a long dev session's
  recompiles invalidate action ids held by the open tab — same class as a
  redeploy), now handled by item 1. Grep confirmed ZERO React key / hydration /
  update-depth / DOM-nesting warnings in our surfaces. Ignored (not our code
  defects): the `@sentry/nextjs` "add global-error.js" infra recommendation, and
  the expected `[realtime] NEXT_PUBLIC_SUPABASE_* missing` dummy-app env warning.


## Wave 4 — as built (2026-09-08) — "Set as background" (Victor's mandate)

Operator-app-only (MediaBrowser + the Layers panel/rail + a new pure helper).
Renderer-only → Vercel (no Fly, no DMG). Changelog 0.1.387. Not yet field-
verified on real projector hardware.

Victor's imperative (from his ProPresenter demo): pressing a media image should
act as the MEDIA/BACKGROUND layer — persistent under the lyrics, showing across
EVERY slide advance, cleared independently. Previously a media send REPLACED the
slide.

### How it rides the existing machinery (no new precedence invented)
- **New pure helper `src/backgrounds/mediaAsBackground.ts`** (`buildMediaBackground`
  + `setMediaAsBackground`): maps a media asset → a custom `PFBackground` and
  routes it through the EXISTING custom-background path — `addCustomBackground()`
  + `setActiveBackgroundId()` in `backgroundStore.ts`, the SAME machinery
  `BackgroundUploader` already uses. That fires `BACKGROUND_CHANGED_EVENT` →
  `useBackgroundState` → `toBackgroundSpec` → `backgroundSpec` on `OutputState`
  (`OperatorConsole.tsx:399-400`), so it renders BEHIND the text via
  `BackgroundLayer` on every output surface and PERSISTS across slide advances
  (the background layer is independent of the slide). Works on ALL churches
  (rides `OutputState.background`), not only `layersV2` ones.
- **Invariants respected, unchanged**: an image/video set this way is a
  Background-Template-class background, so it obeys the existing precedence —
  **camera-wins** (`outputStateToLayers`: `backgroundEnabled = bgActive &&
  !transparent && !videoInput`), **theme/template mutual-exclusivity** (applying
  a theme that carries its own background calls `setActiveBackgroundId("none")`,
  as before), and **"last explicit pick wins"** persistence (a media pick stamps
  `PICKED_AT_KEY` like any template). No precedence rule was added or changed.
- **Video**: enabled too. `BackgroundSpec.type:"video"` + `videoUrl` is already a
  first-class, validated shape (`isValidBackgroundSpec`), and `BackgroundLayer`
  renders a background video muted + `loop` + `autoPlay` + `playsInline`
  (warn-free, PROPRESENTER_MVP_SPEC Ch16 motion-background default); default
  playback speed 1. No validator change needed.

### UI (MediaBrowser)
- Context-menu **"Set as background"** (lucide `Images`, tokens, no emoji) on
  every image AND video card, in its own separator group — distinct from the
  existing (theme-system) "Set as theme background".
- A discoverable **"Background" hover pill** (bottom-right, clear of the bulk
  checkbox / Edit pill / filename bar) as the split affordance alongside the
  one-click send. Keyboard-activatable.
- **Undoable**: snapshots the prior background state (`snapshotBackgroundState`)
  and restores it exactly on the toast's Undo (`restoreBackgroundState`) — mirrors
  the theme quick-change Undo idiom.

### Clear semantics (honest, no divergence)
- The **Layers panel background row** + the **VerticalClearRail background cue**
  already clear the background via the layer override; Wave 4 makes the clear
  HONEST across the whole app by ALSO calling `setActiveBackgroundId("none")` on
  the background-row clear (and on Clear All). So the base `BackgroundSpec` goes
  away on EVERY projector (layersV2 or not) AND the legacy Backgrounds/Themes
  picker shows None — single source of truth, no store/override divergence.
  "Clear background → background disappears, lyrics stay" (test-locked).

### Tests
`test/media-as-background.test.ts` (8): image/video→valid PFBackground+valid
BackgroundSpec, stable de-dupe id, persists-as-active, derived layer enabled,
**background persists across a slide advance** (background layer byte-identical
while the slide layer changes), **clear-background leaves the slide intact**,
**set-as-background respects camera-wins**. Affected suites re-run green
(background-persistence 9, output-layers 13, layer-wire 25, output-layers-render
9, output-compositor 17); tsc clean.

### Wave-4 fix pass (2026-09-08) — as built
- **Cross-restart URL re-mint (DONE)**: `/api/media/list` now returns `mediaKey`
  (the durable S3 key), the MediaBrowser `Asset` carries it, and
  `setMediaAsBackground` threads it onto the `PFBackground` (`buildMediaBackground`
  sets `mediaKey` when present). So a background set from the library re-mints a
  fresh presigned URL on the existing `useBackgroundState` path across a full app
  restart — no more stale-URL fail-safe hours later. The re-mint endpoint
  (`/api/media/url`) is church-scoped (key's first segment must equal the caller's
  churchId — IDOR guard), so storing the key (not just a presigned URL) is safe.
- **Delete honesty (DONE)**: `MediaBrowser.deleteAsset` + `bulkDelete` now call
  `removeCustomBackground(\`media-bg-\${id}\`)` — deleting an asset that was the
  ACTIVE background resets the store to None (never points the projector at a
  deleted asset, never lists a dead entry in the Backgrounds picker).
- **Theme-menu rename (DONE)**: the theme-system items are now "Save into theme:
  Background" / "Save into theme: Logo" (toasts aligned: "Saved into theme
  “name”: Background/Logo") so they read as distinct from the Background-Template
  "Set as background". The Background-Template "Set as background" is unchanged.
- **Post-click hint (DONE)**: a plain-click IMAGE send while a service is live
  shows a success toast with a "Set as background instead" action — one tap sets
  the media as the background layer. Honest/minimal: the just-sent image slide
  stays up until the operator advances (no auto-restore of the previous slide);
  the toast copy says so. No new state machine.
- **`kind` union normalized at the boundary (DONE)**: `normalizeMediaKind()`
  collapses loose/MIME kinds to `"image" | "video"` ONCE in MediaBrowser before
  calling `setMediaAsBackground`; the helper's public surface (`MediaBgAsset.kind`)
  is now the two-value union — no `startsWith` sniffing inside build/set.

### Deferred / honest gaps
- **localStorage key churchId-scoping (DEFERRED, migration note)**: the background
  store keys (`presentflow.backgrounds.custom.v1` / `.activeId.v1` / stamps) are
  global, NOT church-scoped. Scoping them by churchId would ORPHAN every existing
  stored background/active-id on upgrade (the new key reads empty), so it needs a
  one-time migration (copy the legacy global key into the church-scoped key on
  first read) before it can ship safely. Deferred — the practical risk is low on a
  single-church desktop shell (one operator, one church per install).
- **Remaining ProPresenter clears (roadmap, NOT built)**: the reserved,
  non-operable layer kinds map to existing PresentFlow features to be folded into
  per-layer clears in a later increment — **audio** = Phase 5 (audio routing +
  the reserved `audio` LayerKind, Audio Bin clear semantics); **announcements** =
  the existing announcement bar (`OutputState.announcement`); **messages** = the
  operator message overlay (`operatorMessage`); **props** ≈ the theme **logo**
  (already a layer/clear) and future prop overlays. These stay reserved
  placeholders until their increment.

### Wave-5 fix pass (2026-09-08) — as built

- **Engine action guards (DONE)**: `ACTION_BINDINGS` now carries `requiresConfirm:
  true` on the destructive actions (**KILL / CLEAR_ALL_LAYERS / BLANK**);
  `dispatchAction(ctx, action, { confirmed? })` REFUSES a guarded action unless
  `confirmed:true` and returns `{ handled: boolean, reason? }` — every previously
  silent path is now explicit (`todo-wired` / `engine-only` / `refused-guard` /
  `unknown`). See the hard Phase-3 precondition in `docs/ENGINE_INTEGRATION.md`
  (macro/timeline/remote surfaces MUST pass `confirmed:true` only after an
  operator-facing guard equivalent to the UI press-and-HOLD). Tests:
  `test/engine-actions.test.ts` (guard refuse/confirm + handled-result coverage).
- **Hidden vs cleared legibility (DONE)**: `useLiveLayers` exposes `isEyeHidden(id)`
  (reads the same off-wire `eyeHiddenRef`, NEVER emitted). `LayersPanel` now shows
  a disabled row honestly: a HIDDEN row keeps the line-through label + `EyeOff` +
  "Show layer" tooltip; a CLEARED row (destructive, payload gone) shows a dimmed
  "Cleared" caption and a dimmed eye ("re-enable to show content again").
- **Media Bin hardening (DONE)**: lazy fetch (no `/api/media/list` hit until the
  bin is first opened; count badge appears only once resolved, header shows
  without it before), inline grid capped at 60 with an "Open full library (N
  more)" row, videos use `preload="none"` + `poster` (thumbUrl when available).
  Changelog wording corrected to "docked below the Playlist".
- **Hygiene (DONE)**: deleted the orphaned `pro/MediaStrip.tsx` (zero importers);
  fixed the stale ProOperatorShell layout diagram (Media Bin is a collapsible
  left-rail dock, NOT a bottom strip); `swapBackground` self-heals by dropping any
  stale `background` eye-hidden mark; cue-sheet uses the `asId<T>()` helper for
  the ItemId/SlideId casts.

**Field-verify (untested — needs real mic + projector, per CLAUDE.md rule 7):**
an **operator refresh mid-service DROPS all manual layer tweaks (hides / swaps /
zones) BY DESIGN** — overrides are React state + a fresh `layersEpoch`, so a
reloaded operator tab authoritatively clears the override map and the projector
converges back to the derived base stack. This is intentional (a ghost/stale tab
can never re-impose old overrides) but the operator should know a refresh is a
clean slate, not a restore.

**Media-Bin vs Media/PRO coexistence (intended-for-now)**: the left-rail Media
Bin and the existing "Media / PRO" upsell section currently coexist (the Bin is
inserted above the PRO section, keyed off the same `mediaStripOpen` shell state).
This is intended for now — they serve different jobs (quick drag-strip vs the
upsell/entry). CONSOLIDATION FOLLOW-UP: fold the PRO section's entry into the Bin
header (or drop the separate section once the Bin fully subsumes it) so there is
one media surface in the rail.

**Coherence roadmap decision (engine phasing):** NEXT ENGINE PHASE = **Groups &
Arrangements** (a cue-sheet extension — the only unbuilt P0), THEN the **Timer
engine** (P4), THEN **themed Messages**. **Macros are DEFERRED** until the set of
dispatchable primitives is rich enough to justify sequencing them (a macro over
today's action set buys little; it pays off once Groups/Timers/Messages give it
real primitives to chain — and only behind the `requiresConfirm` guard above).

---

## Wave 6A — Media Bin relocation + drag-to-slide (0.1.391, 2026-09-08)

Field fix correcting the Wave-5B placement (operator video: "the media bin should
be under the slides, not on the left").

- **Media Bin → CENTER bottom strip (DONE)**: removed the left-rail
  `MediaBinSection` mount; it now docks the bottom of the center `<main>` column
  (below the slide grid + stage), pushing the stage strip up. Still driven by the
  TopBar media toggle via `mediaStripOpen`. The component is unchanged in data
  behaviour (kept Wave-5 hardening: lazy fetch, 60-cap, `preload="none"`); only
  its container styling flipped to a `border-top` bottom strip and it gained a
  **pop-out (v1)** button — `poppedOut` state in `ProOperatorShell`
  (`mediaBinPoppedOut`) expands the open strip to a taller band (`min(46vh,420px)`
  vs the slim 148px default). Hidden while OpenFlow owns the center.
- **Drag-drop from the Bin into the slide area, two behaviours (DONE)**: the Bin
  thumbnails already emit the single `application/x-pf-library-item` MIME (cross-OS
  in-app). `SlideGrid` now classifies drops via the pure, unit-tested
  `src/lib/media-drop.ts` (`parseMediaDropPayload` / `isImageAsset` /
  `resolveMediaDrop`): (a) drop ONTO a slide card → sets THAT slide's per-slide
  background (`setSongSlideBackgroundImage` — preserves objectsJson objects/bgColor,
  swaps `bgImageUrl`; slide stays editable), with a brand ring + "Set as
  background" badge affordance; (b) drop into empty grid space → creates a new
  full-screen image slide (`createSongImageSlide` — `bgImageUrl`-only, NO sibling
  style inheritance), with a dashed grid outline + "Drop to add a full-screen
  image slide" caret. Both actions are editable-song-only (honest toast otherwise)
  and images-only (video/unknown rejected). Both new server actions are
  `requireCap("edit_library")` + church-scoped. Tests: `test/media-drop.test.ts`
  (8 pass — parse/gate/classify/clamp).
- **Per-slide vs all-slides background (DONE, clarified)**: the canonical song-slide
  editor `BackgroundPanel` ALREADY defaults `setBg` to the CURRENT slide only and
  carries the ember (brand) "Apply background to all slides" button; added an
  explicit "this slide only" helper line so the default scope is unambiguous. The
  GLOBAL Background-Template flow (`setMediaAsBackground`, the "Bg" hover pill) is
  intentionally broad (behind ALL slides by design, Wave 4) and left unchanged —
  converting it to per-slide would regress the Background-Templates architecture.
- **SlideGrid changes kept minimal + additive** (drop handlers + affordance only)
  to coexist with the concurrent Groups & Arrangements work on the same file.

**Field-verify (untested — needs the real console):** drop a media thumbnail onto
a lyric slide → background lands, lyrics stay on top and editable; drop into empty
space → a new full-screen image slide appears at the end; pop-out expands the bin;
non-song items show the honest "songs only" toast.

---

## AS-BUILT — Groups & Arrangements (0.1.390, 2026-09-08)

Delivers the "Arrangements" cue-sheet extension named above (edit-once-update-
everywhere is the differentiator). Additive + no-regression: a song with no
groups projects byte-identically to before.

**Data-model choice (relational, not JSONB-on-songs).** Slides already live as
rows (`song_slides`: order, lyrics, objects_json, stable id). Making groups
reference the PHYSICAL slide rows and arrangements reference groups means an
arrangement never copies a slide — it repeats a reference — so editing a slide
(existing `saveSlideObjects` / `updateSongSlideText`) updates every arrangement
instance for free. JSONB-on-songs would have forked the source of truth and
broken edit-once. Migration: `docs/migrations/2026-09-08-add-song-groups-and-arrangements.sql`
(idempotent, rollback + migrate-first noted; applied to local `faithflow`).
- `song_groups` (church_id, song_id, name, kind, color, order) — named sections.
- `song_slides.group_id` — nullable FK, ON DELETE SET NULL (NULL = ungrouped =
  the no-regression line; deleting a group never deletes its slides).
- `song_arrangements` (church_id, song_id, name, is_default, order jsonb =
  string[] of group ids repeatable, sort).
- Arrangement PIN on a playlist item = `service_items.payload.arrangementId`
  (JSONB) — matches the established slideOrder / themeId / pptxSlideOrder
  precedent; no column, purely additive. Same song can appear twice in one
  playlist with different pins, zero duplication.

**Engine** `src/engine/arrangements/` — pure model: `expandArrangement(song,
arrangementId?)` (unknown/undefined pin → master natural order; custom → groups
in order, repeatable, same identities), `masterOrder`, `hasGroups`,
`slidesInGroup`, `groupColor` + `GROUP_KIND_COLORS` (ProPresenter-style token
palette). Tests: `test/arrangements.test.ts` (10 pass) — locks no-regression,
edit-once identity, deleted-group skip, and cue-sheet agreement (an arranged
expansion drives `buildCueSheet` in order).

**Loader** `getExpandedServicePlan` expands a song item through
`payload.arrangementId` when present (fast path: zero extra queries when absent);
a deleted/empty pin falls through to the legacy natural/slideOrder path (never a
dead-end).

**Server actions** (church-scoped via assertSongOwned/assertGroupOwned/
assertArrangementOwned, field whitelists + caps): createSongGroup, renameSongGroup,
recolorSongGroup, deleteSongGroup, assignSlidesToGroup, createArrangement,
renameArrangement, deleteArrangement, reorderArrangement, setServiceItemArrangement
(operate_services), getSongArrangementModel. Caps: 60 groups/song, 30
arrangements/song, 200 refs/arrangement.

**UI** (functional, minimal, ProPresenter-familiar) — `SongArrangements.tsx` on
the song page: create/rename/recolor/delete groups, tag each slide to a group
(colour dots), and a two-row arrangement editor (available groups → click to
append, repeatable; play order with move/remove/save).

**DEFERRED (documented, backend ready):**
- Playlist item kebab "Arrangement →" picker in the live operator shell
  (`PlaylistSection.tsx`, 1143 LOC). `setServiceItemArrangement` is built +
  typechecked; held back from the live shell to respect the no-regression
  mandate (needs the plan-reload wiring + ExpandedItem to carry arrangementId).
- Drag-and-drop in the arrangement editor + colour-coded group badges directly
  on the operator `SlideGrid` thumbnails (current editor uses click/append + a
  slide-tagging list).
- KNOWN LIMIT: the simple lyrics autosave editor (`updateSongSlides`) rewrites
  all slide rows on save (new ids, group cleared) — assign groups after lyrics
  settle; per-slide rich edits preserve groups. Surfaced in the UI copy.

## Wave 6F — layer cue toggle + logo set + honest background surface (0.1.394, 2026-09-08)

Field repair from operator recordings (rec10/11/14), all renderer-only → Vercel
(no Fly, no DMG). No new render path, storage, or wire message introduced.

- **Rail cues are now NON-DESTRUCTIVE toggles (rec10)**: `VerticalClearRail`'s
  per-layer cues previously fired the destructive `clearLayer` (payload gone).
  They now call `toggleLayer` — the SAME non-destructive hide/show the panel eye
  uses (lit=live → click hides → click again restores exactly what was there, via
  the 5A eye-hidden round-trip). Tooltips are honest ("Hide/Show <layer>"; a
  CLEARED layer reads "cleared — restore from the Layers panel"). Destructive
  clear stays on the panel per-row trash + the rail's guarded Clear All. Zero new
  state — reuses `liveLayers.toggleLayer` / `isEyeHidden`.
- **Background cue truthfulness (rec14)**: the cue lit-state already derives from
  the same `row.active` the resolver renders from (`computeActive` background =
  payload && type !== "none"); the stale-tab base-clobber that made it appear
  desynced was fixed by 6B (`isStaleLayersSnapshot`). With the toggle semantics
  the cue now round-trips against /live in both directions, including after a
  theme apply (the `reconcileBackgroundOnBaseChange` heal already re-emits).
- **Logo set/upload (rec5)**: the Logo row gained a swap/upload affordance
  mirroring the background swap. It reuses the SHARED media upload helper
  (`src/lib/media-upload.ts` — extracted presign→PUT→signed-url flow) and the
  existing `setMediaOnActiveTheme("logo", url)` machinery, which persists the
  logo on the active theme AND pushes it live via `presentflow:theme-changed`.
  One-tap Undo via the returned `revert()`. The logo layer's lit indicator tracks
  `appearance.logoUrl` as before.
- **Background thumbnail freshness (rec11)**: the background row's swap button now
  renders a live `BackgroundThumb` from `ctx.background` (image/video preview or a
  colour swatch for shaders) instead of a static icon — updates the instant the
  background swaps or a media background is set.
- **Honest Save copy (rec11)**: the Layers-panel background swap is the GLOBAL
  Background Template, which already applies live AND auto-persists (background
  store → localStorage, "last pick wins"). Rather than add a misleading Save /
  Save-to-all button there, the surface states "Applied live · saved
  automatically". Per-slide background overrides keep their "Save to all" in the
  slide editor (6A/6E), which is the correct surface for that scope.

Tests: layer suites green via tsx (layer-store 13, layer-wire 25, output-layers
13, output-layers-convergence 26, output-layers-render 13); tsc clean. The rail
toggle reuses already-tested `toggleLayer`/`isEyeHidden` round-trip logic (5A/6B
suites), so no new pure-logic branch was added to test.
