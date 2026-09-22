# PresentFlow timers — current-state map (from 2 research agents, 2026-09-21)

## Two coexisting timer systems
- LEGACY "quick timer": useTimerSession (hooks.ts:60-112), localStorage `presentflow.pro.timer.v1`,
  own 250ms interval, posts wire overlay WITHOUT `id` => reserved "default" slot.
- WAVE 7 named timers: useTimersSession (hooks.ts:154-304) on pure engine src/engine/timers/index.ts.
  TimerSlot = {def, targetClock, runtime, remaining, overrun, shown, position, scale}.
  shown/position/scale are React state (RuntimeMeta hooks.ts:152); only position+scale persist to
  localStorage `presentflow.pro.timers.runtime.v1` (setMetaFor 239-250). `shown` never persists.
  Defs persist in DB table `timer_definitions` (schema.ts:576-591, church_id scoped,
  actions.ts:2081-2136 list/create/update/delete, requireCap("edit_library"), MAX_TIMER_DEFS cap).

## Publish (ProOperatorShell.tsx)
- ONE channel: overlayChRef = openLiveChannel() (2376).
- Legacy heartbeat 1Hz 2478-2508; clear = {clear:true} (no id).
- Named heartbeat 1Hz 2510-2550, keyed on shownTimerKey (`id:position:scale`, 2517);
  per-id clear {clear:true,id} when a slot stops being shown (2541-2544).
- presentflow:timer-command CustomEvent (2552-2572): timerId "default" -> legacy, else timers.command.

## Wire (src/lib/broadcast.ts)
- TimerOverlay 469-481; LiveMessage {type:"timer", overlay} 494; isValidTimerOverlay 570-589
  (remainingSec -3600..86400, id LAYER_ID_RE ^[A-Za-z0-9_-]{1,64}$, scale 0.25..8, position OVERLAY_POSITIONS).
- Validator is an ALLOW-LIST: unknown extra fields are neither rejected nor stripped. New field must be
  explicitly validated.
- NO per-message target/channel concept ANYWHERE. One postMessage fans out to every surface.

## Receivers
| surface | legacy pos | named pos | scale | timers at all |
| /live | yes (591) | yes, grouped by position (608-628) | yes | yes |
| /stage | n/a fixed top-right | NO (type lacks position; fixed corner stack 350-379) | yes | yes |
| /livestream | NO | NO (TimerItem lacks position, 61-62; render 544-573, gated mode==="full") | yes | yes |
| /ndi | - | - | - | **NONE — zero timer code** |
All three have 1Hz stale-sweep: legacy 5s via lastTimerMsgAt, named per-id 5s via namedTimerAtRef.

## Transport gaps (IMPORTANT)
- src/lib/realtime.ts only carries full OutputState ({type:"output"}) on ff-out-<churchId>-<pairCode>.
  It does NOT carry the discrete `timer` LiveMessage.
- electron/lan/LanOverlayServer.ts publish(state) likewise only relays OutputState; dumb byte relay,
  zero timer code.
=> Timer overlays are effectively SAME-MACHINE ONLY (BroadcastChannel + Electron IPC) today.
   Cross-device paired projector and LAN OBS overlay likely never see timers. VERIFY before claiming.

## Tokens
- src/engine/timers/messages.ts expandMessageTokens: {{timer}} / {{timer:ID}} expanded OPERATOR-SIDE at
  post time from in-memory snapshot, never from wire. Targeting must not gate this snapshot.

## Tests
- test/engine-timers.test.ts, test/engine-timers.stress.test.ts — PURE ENGINE ONLY.
- Wire shape / fan-out / render path for timers is ENTIRELY UNTESTED.

## Agreed design steer from the no-regression audit
- SENDER-SIDE filtering (skip the post for non-targeted surfaces) is safer than receiver-side
  `ov.targets.includes(me)`, because stale/old output tabs then just stop hearing heartbeats and the
  EXISTING 5s stale-sweep clears them. Receiver-side filtering leaves old bundles showing everything. 🔴
- BUT sender-side-only filtering is impossible over a single shared BroadcastChannel (one post reaches
  all). => need either per-surface topics/channels, or receiver-side filter, or a hybrid. RESOLVE IN PLAN.
- `targets` absent MUST mean "all surfaces" = today's exact behaviour (backward compat).
- Removing a target from a showing timer must issue an explicit retroactive per-id clear (extend the
  existing 2541-2544 "was shown, isn't now" logic).
