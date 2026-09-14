# Wave 7 — Timers + Messages (as-built)

Branch: `feat/decoupling-layers-panel`. The last unbuilt ProPresenter P0 (multi-timer)
plus its display vehicle (messages), and the rec6 ask: **"take out messages and timers
from Settings and give them their own individual sections."**

## What shipped

### 1. Multi-timer engine (`src/engine/timers/`)
- `index.ts` — PURE, deterministic core. `TimerDefinition` (countdown / countdown_to /
  elapsed) + `TimerRuntime` (anchor + banked-value model, so a tick never mutates state).
  `computeRemainingSec` returns a SIGNED value (negative = overrun); `isOverrun`,
  `startTimer`/`stopTimer`/`resetTimer`/`applyCommand`, `formatTimerClock` (`[-]H:MM:SS`),
  `parseDurationToSec`. Every fn takes an explicit `nowMs` → fully unit-testable.
- `overlay.ts` — pure `timerToOverlay` mapper to the existing `TimerOverlay` wire shape
  (folds countdown_to → wire kind "countdown").
- Tests: `test/engine-timers.test.ts` (11) — countdown/elapsed/countdown_to, overrun,
  stop-resume banking, idempotent start/stop, format/parse.

### 2. Church-persisted definitions
- `timer_definitions` (name/type/duration_sec/target_clock) and `message_templates`
  (name/text/position/config jsonb) tables — Drizzle in `src/lib/db/schema.ts` + idempotent
  `docs/migrations/2026-09-08-add-timer-definitions-and-message-templates.sql` (applied to
  local `faithflow`).
- CRUD server actions in `src/lib/actions.ts` (`list/create/update/delete` for each), gated
  by `requireCap("edit_library")`, church-scoped on every query, sanitized inputs.
- Runtime state (running / shown / position / scale) is session-only — never persisted, so a
  fresh Sunday never resurrects last week's countdown.

### 3. Wire (additive, no-regression)
`src/lib/broadcast.ts`:
- `TimerOverlay` gained optional `id` (keys a named timer — absent ⇒ legacy "default" slot),
  `overrun`, `scale`, `color`. `{clear:true, id}` clears one named timer.
- `LiveMessage` message variant gained optional `messages: MessageOverlay[]`; `MessageOverlay`
  gained optional `id`. The legacy single `overlay` stays authoritative for old projectors.
- Validators extended (id charset, scale bounds, color, messages[] length+each-valid) and
  `coerceLiveMessage` salvages a valid overlay while dropping bad `messages[]` entries.

### 4. Operator sections (rec6)
- `useTimersSession` (multi named timers, DB-backed) and `useMessagesBoard` (templates +
  active-messages list) + `expandMessageTokens` in `pro/hooks.ts`. Legacy `useTimerSession` /
  `useMessagesSession` kept untouched (the "default" slot / composer).
- New `TimersPanel` + `MessagesPanel` with their OWN right-rail icons (stopwatch / speech
  bubble). Removed from the Settings sub-nav. `ProOperatorShell` publishes keyed timer
  overlays + the multi-message array (legacy paths byte-identical) and routes
  `presentflow:timer-command` events.
- Per-timer **Size** slider (0.5×–5×); "Clear Messages" clears all active extras.

### 5. Engine dispatch
`TIMER_COMMAND {timerId, start|stop|reset}` action + `ctx.onTimerCommand` (CustomEvent →
shell session; "default" → legacy quick timer). `SEND_MESSAGE`/`CLEAR_MESSAGE` were already
ctx-wired. Tests: `test/engine-actions.test.ts` (updated, completeness holds).

### 6. Renderers (`/live`, `/stage`, `/livestream`)
Each additively handles keyed timers (per-id map, per-id 5s stale sweep) and the message
`messages[]` array (stacked extras; allowWeb-gated on the public livestream). Timers render as
clean big numbers (no box/border), sized by `scale`, red on overrun. Stage shows named timers
as confidence-monitor clocks.

## Browser-verified (dev :3005, JPD Demo Church)
1. Created a "Sermon" 20s countdown in the Timers panel → persisted to `timer_definitions`.
2. Started + showed it → appears on `/stage`, ticks, and counts past zero to `-00:11` in red.
3. Composed "Sermon ends in {{timer}}", Saved as template (persisted), Activated → shows on
   `/live` with the live timer value ticking (`-1:38 → -1:47`).
4. "Clear Messages" removed the message from `/live` while the timer kept running on `/stage`
   (independent hide/clear).
5. Size slider 4× → `/live` timer renders at ~110px clean red numbers, transparent parent
   (no box, no border).

## Deferred / notes
- Stage still multiplexes the LEGACY timer + `countdownEndsAt` in one corner chip; named
  timers render as their own clean stack beside it.
- Message `{{timer}}` binding is expanded operator-side at 1Hz post time (like {{time}}), so it
  updates each second without coupling renderers to timer state.
- Renderer-only + DB migration → Vercel + `psql`/`db:push` (no Fly, no DMG). Not deployed; not
  merged. Full six-agent ship gate + real projector verification still pending per CLAUDE.md.
