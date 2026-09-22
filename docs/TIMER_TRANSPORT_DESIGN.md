# Timer networked delivery — design findings (2026-09-21)

## Verified gap (definitive, evidence-backed)
Timer overlays are SAME-MACHINE ONLY. Not probabilistic — the data never enters the networked pipes.
- ProOperatorShell.tsx:2377 posts timers ONLY on overlayChRef = openLiveChannel() (BroadcastChannel + Electron IPC).
  Legacy heartbeat 2478-2508 (clear 2486, tick 2494); named heartbeat 2510-2550 (tick 2528, per-id clear 2543).
- grep "openOutputChannel|getLanServer" in ProOperatorShell.tsx => ZERO hits. It never touches Supabase Realtime
  or the LAN server for anything.
- OutputState (broadcast.ts:366-405+) has NO timer field of any kind.
- realtime.ts only sends/receives "output" + "snapshot_request". No "timer" event exists in the file.
- LanOverlayServer.publish (308) gates on looksLikeOutputState (93, `"live" in s`) and relays {type:"output"} only.
=> A paired tablet stage display or LAN/remote OBS source will NEVER see a timer today.

## 🔴 COST FINDING — do not ship a naive 1Hz heartbeat over Supabase Realtime
- realtime.ts:46 sets client-side `eventsPerSecond: 20` (self-throttle, not a server quota). No other throttling/batching.
- Supabase limits: Free 2M msgs/month; Pro 5M/month included then $2.50/million. Quota is PROJECT-WIDE, not per church.
- Fan-out counts per recipient. ONE church + ONE continuously-running timer + 2 subscribed surfaces
  ~= 2 msg/sec ~= 172,800/day ~= 5.2M/month. That alone can exceed the ENTIRE Pro monthly allowance,
  before OutputState traffic and before any other church on the project.
- Named timers heartbeat INDEPENDENTLY per id (2510-2550) => 3 named + legacy = 4x => >4M/month from one church.
  Scales linearly and badly.

## RECOMMENDED: option (c) — anchor-based, event-driven + low-frequency liveness
The engine (src/engine/timers/index.ts) is already PURE and derives value from (now - anchorMs).
So push the DEFINITION + ANCHOR, not the computed value:
  {id, kind, anchorMs/targetEpochMs, durationMs, baseSec, running, position, scale}
published ONLY on state CHANGE (start / pause / resume / edit / stop / position / scale).
Each receiving surface runs its own local tick against the anchor using the SAME pure function.
Cost becomes linear in state CHANGES (rare) instead of linear in TIME.

### Clock skew (🟡, must implement + field-test)
Receiver mixing its own Date.now() against sender's anchor is the risk. Mitigation: anchor payload carries the
SENDER's Date.now() at send time; receiver computes a one-time offset (senderNow - localNow) and applies it to all
future ticks, refreshed on every reconnect. Both transports ALREADY have a snapshot/reconnect hook to hang this on
(realtime.ts:151-158, LanOverlayServer.ts:191-195). Field-test with a genuinely skewed device clock.

### Stale-sweep redesign (🟡)
Today's 5s stale-sweep exists because the 1Hz heartbeat IS the liveness signal. With no heartbeat there is nothing
to go stale, so a receiver that misses an explicit clear would tick a frozen timer forever.
Fix: keep a LOW-FREQUENCY idempotent liveness ping (~every 15-30s, same anchor) and lengthen the sweep window to
~45-60s. Preserves the safety net at ~1/15-1/30 the volume. Explicit {clear:true,id} already exists (2486, 2543).
CAUTION: the sweep window is shared self-heal behaviour across /live /stage /livestream /ndi — verify no regression.

### Rejected
(a) fold computed timer values into OutputState — forces the whole (much larger) OutputState to republish at 1Hz.
(b) relay the discrete timer LiveMessage on both transports — simplest to build but locks in the 1Hz network tax
    permanently. Acceptable only as an explicitly-labelled stopgap, never as the final architecture.

## NDI — cheap, orthogonal, do it independently 🟢
/ndi (page.tsx:89) subscribes to the SAME same-machine BroadcastChannel as /live and handles
set/clear/pong/output/layer-patch (106-130). There is NO `timer` branch — a timer message is received and silently
ignored (structural no-op, not a crash). electron/ipc/ndi.ts: NDI capture is a hidden BrowserWindow loading /ndi
whose paint frames feed the native sender — so overlay compositing IS whatever this React page renders; no separate
downstream compositor. Fix = add the missing position-aware `timer` render branch (match /live, not /stage's fixed
corner stack, since NDI feeds external switchers). Needs NONE of the cross-device transport work.

## Backward compatibility 🟢
Supabase broadcast subscriptions are PER-EVENT (channel.on("broadcast",{event}) — realtime.ts:136,151), so an old
client never even receives a new event name. LAN/NDI switches ignore unrecognised `type` by fallthrough. OutputState
parsing is an allow-list that neither rejects nor strips unknown fields. Additive-only is the proven house pattern
(broadcast.ts:377 "all optional, additive").

## 🔴 Test gap
There is NO existing test coverage for ANY timer wire/relay behaviour — test/engine-timers*.test.ts is pure-engine
only. New relay paths, the stale-sweep timing change, and old-client no-op behaviour all need tests before ship.
