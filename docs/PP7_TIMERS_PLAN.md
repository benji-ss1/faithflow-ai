# PresentFlow — ProPresenter 1:1 Timers: consolidated plan (2026-09-21)

Research inputs: docs/PP7_TIMER_SPEC.md (verified PP7 behaviour), docs/TIMERS_CODE_MAP.md (current code),
docs/TIMER_TRANSPORT_DESIGN.md (networked delivery + cost). User decisions 2026-09-21: TRUE 1:1, FIX networked
transport in this build, INCLUDE NDI.

## The central architectural fact
ProPresenter has NO per-timer output picker. A Timer is an abstract VALUE SOURCE; destinations BIND to it by
reference (stage layout linked-text elements; Themes + Messages tokens for the audience screen). The user ALSO
wants explicit per-output targeting with multi-select. These are reconciled as two different questions:

  1. "Does a timer appear on screen X at all?"  -> SCENES (coarse, per-screen on/off, multi-select)
  2. "Where and how does it look once it does?" -> stage_layouts/elements (stage) + message linked-text (audience)

Exactly one mechanism governs visibility (Scenes), so there is never a second source of truth.

## Why Scenes is the right seam (verified, not assumed)
- src/lib/scenes.ts:26 SCENE_SCREENS = ["main","stage","livestream","ndi"] -> Projector/Stage/Livestream/NDI feed.
  The four destinations already exist and are church-persisted.
- src/lib/scenes.ts:40 SCENE_LAYER_IDS lacks "timer" -> the ONLY reason timers aren't already targetable.
- src/lib/scenes.ts:196 sceneHidesLayer(scene, screen, layer) is the masking helper, already called at all four
  output routes for "announcement": live/page.tsx:601, stage/page.tsx:411, livestream/page.tsx:538,
  plus LivePreviewPanel.tsx:241-242 and multiview.ts:147.
- "announcement" is a ROUTE-DRAWN layer — the compositor never sees it, each surface applies the mask itself
  (multiview.ts:150-152 comment). TIMER IS THE SAME CATEGORY. Adding it follows a shipped precedent.
- OutputState.scene (broadcast.ts:503) is relayed by realtime.ts and LanOverlayServer as part of the full state,
  with NO field stripping => scene targeting ALREADY works cross-device and over LAN. Not dormant.
  (Distinguish from OutputState.layers[] content array, which IS still dormant behind NEXT_PUBLIC_LAYERS_V2.)
- SceneBuilderModal.tsx is a shipped [layers x screens] matrix with per-screen appearance override -> the
  multi-select combination UI the user asked for already exists; timers merely need a row in it.

## Phases (targeting first — it is the user's actual ask and it is cheap)

### Phase 1 — Per-screen timer targeting via Scenes  [SMALL, HIGH VALUE] — BUILT 2026-09-21
Add "timer" to SceneLayerId / SCENE_LAYER_IDS / SCENE_LAYER_LABELS. Gate every timer render site with
sceneHidesLayer(scene, <screen>, "timer"), mirroring the announcement precedent exactly.
Acceptance: operator turns Timer OFF for Livestream while it stays ON for Stage + Projector, in any combination;
works cross-device and over LAN with zero new transport code; a church with no scene sees NO change.
Risk: 🟢 sanitizeSceneConfig whitelist-rebuilds against the id list, so stored scenes never populate the new key
until an operator sets it — no migration, no behaviour change for existing scenes.

### Phase 2 — Networked timer VALUES  [MEDIUM — cost concern RESOLVED, see below]
Timer targeting rides scene (Phase 1), but the ticking VALUE is still same-machine-only (verified: ProOperatorShell
posts timers only on openLiveChannel; grep for openOutputChannel/getLanServer there = zero hits).
COST 🔴 -> 🟢 RESOLVED (verified 2026-09-21): a naive 1Hz relay WOULD cost ~5.2M msgs/month for ONE church with ONE
timer and 2 surfaces — the whole Pro allowance, project-wide. But the output publish effect in OperatorConsole.tsx
is NOT a heartbeat: it fires on dependency change only and is short-circuited by a JSON signature dedupe
(lines ~1019-1023) plus a remote coalesce (~1037-1042). So an ANCHOR payload — which does not change as time passes —
produces a byte-identical state and therefore ZERO repeat sends. A 10-minute untouched timer costs exactly ONE send.
Not "reduced 1Hz"; not 1Hz at all.

PRECEDENT: OutputState.countdownEndsAt (broadcast.ts:376, "ms epoch — stage countdown target") is an ALREADY-SHIPPED
anchor-timestamp field riding this exact pipeline for the legacy stage countdown. The pattern is proven here, not novel.

MECHANISM: emit LayerWire {kind:"timer", transportScope:"all", payload:{...anchor...}} into OutputState.layers on
state change. Requires ZERO changes to realtime.ts and LanOverlayServer.ts — both already relay OutputState.layers
untouched (scrubOutputStateForRemote, broadcast.ts:1666-1673, strips only videoInput.deviceId and
transportScope:"local" layers). The wire ALREADY validates this kind: isValidLayersArray dispatches
`case "timer": return isValidTimerOverlay(payload)` (broadcast.ts:800). Only the SENDING side is missing.
NOTE: TimerOverlay carries a COMPUTED remainingSec, so the payload needs an anchor-carrying extension — resolve the
exact shape before coding, and do NOT ship computed-value-at-1Hz over the network.
DO NOT gate the consume-side read behind NEXT_PUBLIC_LAYERS_V2 — that flag guards the unrelated, still-unshipped
compositor swap. Use a narrow `.filter(l => l.kind === "timer")` read per route, and keep it OUT of the
rebuildOverridesFromSnapshot / layersEpoch bookkeeping (🟡) or it inherits ghost-tab edge cases it does not need.
DESIGN: carry the ANCHOR, not the computed value. The engine is already pure over (now - anchorMs), so publish
{anchorMs, baseSec, durationSec, type, running, senderNowMs} on STATE CHANGE ONLY and let each surface tick locally
via the same pure function. Cost becomes linear in state changes, not in time.
  - Clock skew 🟡: payload carries senderNowMs; receiver computes a one-time offset, refreshed on reconnect.
  - Liveness 🟡: if the operator tab dies mid-timer, a REMOTE surface has no heartbeat-loss detector and would tick
    on forever from the last anchor. Same-machine surfaces still self-heal via the existing 5s sweep. RECOMMENDED:
    accept for v1 rather than build a speculative liveness ping; revisit on field data. Decision needed.
  - 🟡 Check whether countdownEndsAt's existing /stage renderer already does clock-offset correction before copying
    its pattern — do not silently inherit a gap.
  - OPEN QUESTION to resolve in build: the existing LayerWire {kind:"timer"} payload is a TimerOverlay, which carries
    the COMPUTED remainingSec. Carrying an anchor needs either an extended payload or a sibling field. Resolve
    before coding; do NOT ship computed-value-at-1Hz over the network.
  - Same-machine BroadcastChannel path stays UNTOUCHED (rule 8) — diff-check zero lines in the heartbeat code.

### Phase 3 — NDI timer rendering  [SMALL, orthogonal 🟢]
/ndi (page.tsx:89) already receives timer messages on the same-machine channel and silently ignores them — there is
no `timer` branch in its switch (106-130). NDI capture is a hidden BrowserWindow loading /ndi whose paint frames feed
the native sender, so overlay compositing IS whatever this page renders. Add the missing position-aware branch
(match /live, not /stage's fixed corner stack). Needs none of the Phase 2 transport work.

### Phase 4 — Schema for the 1:1 feature set  [additive-only, rollback SQL first]
timer_definitions += allows_overrun, time_of_day_sec, period(am|pm|24_hour), elapsed_start_sec,
elapsed_end_sec (NULL = unlimited, per verified PP7), overrun_color.
New tables stage_layouts, stage_screens, stage_layout_elements — all church_id scoped (rule 5) + adversarial tests.
SIGN-OFF NEEDED: adding enum value `countdown_to_time` is a ONE-WAY door (Postgres cannot cleanly drop an enum
value); honest rollback is "leave the unused value, never repurpose it".

### Phase 5 — Stage Layout Editor CRUD (inert, renders nothing yet)
### Phase 6 — /stage generic renderer, opt-in, byte-identical fallback when a church has no layout (rule-0 anchor)
### Phase 7 — Linked-text engine + format options + colour triggers (pure module + tests)
### Phase 8 — Audience-side Linked Text on message_templates.config (reuses {{timer}} token path, does not replace it)
### Phase 9 — Multi-screen stage rollout; revisit Video Countdown / Auto Advance Time

## Reuse, do not duplicate
- themes table = PP7's Theme. stage elements reference themes.id; never a parallel style system.
- message_templates.config.timerId + engine/timers/messages.ts expandMessageTokens = PP7's "Add a Token". ALREADY BUILT.
- ONE formatter: extend engine/timers/index.ts with formatTimerClockWithOptions; formatTimerClock and the linked-text
  resolver both call it. Golden-value tests pinned BEFORE the refactor. 🟡

## DECISION RECORD

**2026-09-21 — Stage Layout Editor is a SEPARATE editor (user-directed).**
A proposal to fold stage layouts into the existing Scene Builder as extra per-screen rows (fewer concepts, one
grid) was PUT TO THE USER AND DECLINED. The user's direction is to copy ProPresenter's separate Stage Layout
editor 1:1. Build it as its own editor with its own list of named layout presets, its own canvas, and its own
live-switch menu — mirroring ProPresenter's Screens > Edit Layouts (Ctrl+4) and the thumbnailed
"Stage Screen: <name>" flyout with "Edit Selected Layout...".

Scenes and Stage Layouts therefore remain DISTINCT, exactly as in ProPresenter:
  - Scene (= ProPresenter "Look")  -> which LAYERS reach which screen, + per-screen theme override.
  - Stage Layout                   -> what the STAGE confidence monitor is built from (widgets + placement).
Phase 1 (timer in the Scene matrix) is unaffected and stays as shipped.

## Sign-off flags
1. One-way enum migration (countdown_to_time).
2. Video Countdown / Auto Advance Time have no underlying PresentFlow concept — recommend reserved/inert enum values
   rather than building renderers, unless the user wants those features to exist at all.

## 🔴 Test gap
No existing coverage for ANY timer wire/relay behaviour (test/engine-timers*.test.ts is pure-engine only).
Every phase touching the wire needs new tests + the rule-2 agent gate.

---

## Open finding: dead exports beyond timers (2026-09-22)

`test/no-dead-capability.test.ts` is deliberately SCOPED to `src/engine/timers`
and `src/engine/stage`. Running it across the whole engine immediately found
exported functions called from nowhere in `src/`:

- `validateSpec`, `sanitizeSpec` — `src/engine/actions/spec.ts`
- `slidesInGroup`, `masterOrder` — `src/engine/arrangements/index.ts`
- `buildCueSheet` — `src/engine/cue-sheet/index.ts`

These are NOT timer code and have not been audited, so the guard does not fail
CI on them — failing on code nobody has read would just get the guard disabled.
But they are the same class that produced five bugs in timers: an uncalled pure
function is a second implementation waiting to disagree with the live one.

Each needs one of: a caller, deletion, or an explicit note saying why it is
kept. Widen the guard's scope as each area is cleared. Do NOT widen it by
deleting code you have not read.
