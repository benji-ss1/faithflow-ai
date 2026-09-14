/**
 * Phase-4 SIX-AGENT GATE — STRESS suite for slide-actions + macros dispatch.
 * Run: npx tsx --test test/engine-phase4-stress.test.ts
 *
 * Attacks the persisted-action delta (b2717f6..998b3e3): recursion bounds,
 * 20-action ordering + partial-failure honesty, macro expansion depth,
 * malformed stored-spec tolerance, deleted-entity references, re-send spam.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateSpec, specToEngineAction, type ActionSpec, type ActionSpecType,
} from "../src/engine/actions/spec";
import {
  dispatchSlideActions, sanitizeSlideActions, validateSlideActions,
  MAX_SLIDE_ACTIONS, type DispatchEngineAction,
} from "../src/engine/slide-actions";
import {
  macroToEngineActions, sanitizeMacroActions, executeMacro,
  MAX_ACTIONS_PER_MACRO, type MacroDefinition,
} from "../src/engine/macros";
import type { EngineAction, EngineActionType } from "../src/engine/actions";

const timer: ActionSpec = { type: "timer", timerId: "t", command: "start" };
const msg: ActionSpec = { type: "show_message", text: "hi" };
const kill: ActionSpec = { type: "kill" };
const macroRef = (id: string): ActionSpec => ({ type: "macro", macroId: id });
function mac(actions: ActionSpec[], enabled = true): MacroDefinition {
  return { id: "m", churchId: "c", name: "M", enabled, actions };
}

// ── Vector 2: recursion is architecturally BOUNDED ──────────────────────────
// The ActionSpec union has NO navigation/send arm (SEND_SLIDE_TO_LIVE / GO_SLIDE
// / STAGE_SLIDE). So no persisted action can ever re-enter fireSlideActions →
// no send→slide-with-actions→macro→send cycle is expressible. Prove it: NO
// valid spec maps to a navigation EngineAction.
test("recursion bound: no ActionSpec maps to a send/nav EngineAction", () => {
  const NAV: EngineActionType[] = [
    "SEND_SLIDE_TO_LIVE", "GO_SLIDE", "STAGE_SLIDE", "SEND_TO_LIVE",
    "SET_PREVIEW_ITEM", "TRIGGER_MACRO",
  ];
  const specTypes: ActionSpecType[] = [
    "set_background_media", "set_background", "timer", "show_message",
    "clear_message", "clear_layer", "send_lower_third", "clear_lower_third",
    "set_announcement", "set_transition", "logo", "blank", "kill",
    "clear_all_layers", "macro",
  ];
  for (const t of specTypes) {
    // Build a minimally-valid spec of each type
    const spec = {
      set_background_media: { type: t, assetRef: { id: "a", url: "u", fileName: "f", kind: "image" } },
      set_background: { type: t, spec: null },
      timer: { type: t, timerId: "t", command: "start" },
      show_message: { type: t, text: "x" },
      clear_layer: { type: t, layerId: "l" },
      send_lower_third: { type: t, line1: "a", line2: "b" },
      set_announcement: { type: t, announcement: null },
      set_transition: { type: t, transition: null },
      macro: { type: t, macroId: "m" },
    }[t as string] ?? { type: t };
    const ea = specToEngineAction(spec as ActionSpec);
    if (ea) assert.ok(!NAV.includes(ea.type), `${t} must not produce nav action ${ea.type}`);
  }
});

test("recursion bound: a hand-corrupted macro-in-macro spec expands to nothing recursive", () => {
  // Even if DB JSONB was corrupted to nest a macro spec inside a macro, the
  // runner skips it (belt+suspenders) — no re-expansion, no crash.
  const corrupted = mac([timer, macroRef("self"), msg]);
  const eas = macroToEngineActions(corrupted);
  assert.deepEqual(eas.map((e) => e.type), ["TIMER_COMMAND", "SEND_MESSAGE"]);
  // slide→macro is exactly ONE level: expanding a slide's macro never re-enters.
  const dispatched: EngineAction[] = [];
  const dispatch: DispatchEngineAction = (a) => { dispatched.push(a); return { handled: true }; };
  dispatchSlideActions(dispatch, [macroRef("self")], () => corrupted);
  assert.deepEqual(dispatched.map((e) => e.type), ["TIMER_COMMAND", "SEND_MESSAGE"]);
});

// ── Vector 1: 20 actions, ordering + partial-failure honesty ────────────────
test("20-action slide fires in order; handled:false reported per-action (honest)", () => {
  const specs: ActionSpec[] = Array.from({ length: MAX_SLIDE_ACTIONS }, (_, i) =>
    i === 3 ? kill : ({ type: "show_message", text: `m${i}` } as ActionSpec));
  // sanitize drops the guarded kill (slide can't be destructive) → 7 remain
  const clean = sanitizeSlideActions(specs);
  assert.equal(clean.length, MAX_SLIDE_ACTIONS - 1);
  const seen: string[] = [];
  // dispatcher refuses one action mid-batch (simulate refused-guard leak)
  const dispatch: DispatchEngineAction = (a) => {
    seen.push((a as { text?: string }).text ?? a.type);
    return (a as { text?: string }).text === "m5"
      ? { handled: false, reason: "refused-guard" }
      : { handled: true };
  };
  const outcomes = dispatchSlideActions(dispatch, clean, () => null);
  // ALL remaining actions still fire in order despite one unhandled → no abort
  assert.equal(outcomes.length, clean.length);
  assert.equal(seen.length, clean.length);
  const failed = outcomes.filter((o) => !o.result.handled);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].result.reason, "refused-guard"); // honest, not silent
});

test("FAULT ISOLATION: a THROWING handler is isolated — the batch continues", () => {
  // dispatchSlideActions wraps each dispatch in try/catch (safeDispatch): a
  // handler that throws becomes an explicit {handled:false, reason:"threw"}
  // outcome and NEVER aborts the rest of the sequence.
  const seen: string[] = [];
  const dispatch: DispatchEngineAction = (a) => {
    const label = (a as { text?: string }).text ?? a.type;
    seen.push(label);
    if (label === "m1") throw new Error("handler blew up");
    return { handled: true };
  };
  const specs: ActionSpec[] = [
    { type: "show_message", text: "m0" },
    { type: "show_message", text: "m1" },
    { type: "show_message", text: "m2" },
  ];
  let outcomes: ReturnType<typeof dispatchSlideActions> = [];
  assert.doesNotThrow(() => { outcomes = dispatchSlideActions(dispatch, specs, () => null); });
  assert.deepEqual(seen, ["m0", "m1", "m2"]); // m2 STILL fired — throw was isolated
  assert.equal(outcomes.length, 3);
  assert.equal(outcomes[0].result.handled, true);
  assert.equal(outcomes[1].result.handled, false);
  assert.equal(outcomes[1].result.reason, "threw"); // honest, surfaced
  assert.equal(outcomes[2].result.handled, true);
});

// ── Vector 1: re-send spam idempotency ──────────────────────────────────────
test("re-send spam: firing the same slide's actions 5x dispatches deterministically", () => {
  const specs: ActionSpec[] = [timer, msg];
  let count = 0;
  const dispatch: DispatchEngineAction = () => { count++; return { handled: true }; };
  for (let i = 0; i < 5; i++) dispatchSlideActions(dispatch, specs, () => null);
  assert.equal(count, 10); // 2 actions × 5 sends; TIMER start is idempotent at
  // the timer engine (startTimer: `if (rt.running) return rt`) so no restart.
});

// ── Vector 3: malformed stored specs on load (loader tolerance) ─────────────
test("malformed stored JSONB is sanitized fail-open on read", () => {
  // Slide actions
  assert.deepEqual(sanitizeSlideActions("not-an-array" as unknown), []);
  assert.deepEqual(sanitizeSlideActions(null as unknown), []);
  assert.deepEqual(sanitizeSlideActions({ 0: timer } as unknown), []); // object, not array
  assert.deepEqual(
    sanitizeSlideActions([timer, kill, { type: "junk" }, null, 42, msg]),
    [timer, msg], // guarded + unknown + non-object dropped
  );
  // Cap still enforced on corrupted over-length arrays
  assert.equal(sanitizeSlideActions(new Array(50).fill(timer)).length, MAX_SLIDE_ACTIONS);
  // Macros
  assert.deepEqual(sanitizeMacroActions([timer, macroRef("x"), { type: "junk" }, kill]), [timer, kill]);
  assert.equal(sanitizeMacroActions(new Array(50).fill(timer)).length, MAX_ACTIONS_PER_MACRO);
  // Partially-corrupt spec fields are rejected structurally
  assert.equal(validateSpec({ type: "timer", timerId: "bad id!", command: "start" }).ok, false);
  assert.equal(validateSpec({ type: "show_message", text: "x".repeat(2001) }).ok, false);
  assert.equal(validateSlideActions([{ type: "clear_layer", layerId: "../etc" }]).ok, false);
});

// ── Vector 5: deleted referenced entities ───────────────────────────────────
test("deleted macro attached to a slide → honest macro-not-found no-op", () => {
  const dispatch: DispatchEngineAction = () => ({ handled: true });
  const outcomes = dispatchSlideActions(dispatch, [macroRef("gone"), timer], (id) => id === "gone" ? null : mac([]));
  assert.equal(outcomes[0].result.handled, false);
  assert.equal(outcomes[0].result.reason, "macro-not-found");
  // the sibling non-macro action STILL fires (no abort)
  assert.equal(outcomes[1].result.handled, true);
});

test("disabled macro attached to a slide resolves to null → skipped (resolver enforces enabled)", () => {
  const dispatch: DispatchEngineAction = () => ({ handled: true });
  // fireSlideActions' resolver returns null for a disabled macro; mirror that.
  const disabled = mac([timer], false);
  const outcomes = dispatchSlideActions(dispatch, [macroRef("m")], (id) => (id === "m" && disabled.enabled) ? disabled : null);
  assert.equal(outcomes[0].result.reason, "macro-not-found");
});

test("deleted timer referenced by an action still maps cleanly (dispatch is a no-op downstream)", () => {
  // specToEngineAction is content-independent: a TIMER_COMMAND for a since-deleted
  // timerId is a well-formed action; the timer engine no-ops on an unknown id.
  const ea = specToEngineAction({ type: "timer", timerId: "deleted", command: "stop" });
  assert.deepEqual(ea, { type: "TIMER_COMMAND", timerId: "deleted", command: "stop" });
});

// ── Vector 2/3: 50 macros × 20 actions bulk load stays bounded ──────────────
test("bulk: 50 macros × 20 actions sanitize/expand within caps", () => {
  for (let m = 0; m < 50; m++) {
    const actions = new Array(30).fill(timer); // over-cap on purpose
    const clean = sanitizeMacroActions(actions);
    assert.equal(clean.length, MAX_ACTIONS_PER_MACRO);
    const eas = macroToEngineActions(mac(clean));
    assert.equal(eas.length, MAX_ACTIONS_PER_MACRO);
  }
});

test("executeMacro on a disabled macro fires nothing; guarded gated on confirmed", () => {
  const calls: { t: string; confirmed?: boolean }[] = [];
  const dispatch = (a: EngineAction, o?: { confirmed?: boolean }) => {
    calls.push({ t: a.type, confirmed: o?.confirmed });
    return a.type === "KILL" && !o?.confirmed ? { handled: false, reason: "refused-guard" as const } : { handled: true };
  };
  assert.deepEqual(executeMacro(mac([timer, kill], false), dispatch, { confirmed: true }), []);
  const out = executeMacro(mac([timer, kill]), dispatch, { confirmed: false });
  assert.equal(out[1].result.handled, false); // kill refused without confirm
});
