/**
 * engine/slide-actions + actions/spec tests.
 * Run: npx tsx --test test/engine-slide-actions.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateSpec, validateForSlide, validateForMacro, isGuardedSpec,
  specToEngineAction, type ActionSpec,
} from "../src/engine/actions/spec";
import {
  validateSlideActions, sanitizeSlideActions, dispatchSlideActions,
  MAX_SLIDE_ACTIONS, type DispatchEngineAction,
} from "../src/engine/slide-actions";
import type { MacroDefinition } from "../src/engine/macros";
import type { EngineAction } from "../src/engine/actions";
import { dispatchAction } from "../src/engine/actions";

const bgMedia: ActionSpec = { type: "set_background_media", assetRef: { id: "a", url: "https://x/y.jpg", fileName: "y.jpg", kind: "image" } };
const timer: ActionSpec = { type: "timer", timerId: "default", command: "start" };
const msg: ActionSpec = { type: "show_message", text: "Welcome" };
const clearLayer: ActionSpec = { type: "clear_layer", layerId: "background" };
const macroRef: ActionSpec = { type: "macro", macroId: "m1" };
const kill: ActionSpec = { type: "kill" };
const blank: ActionSpec = { type: "blank" };
const clearAll: ActionSpec = { type: "clear_all_layers" };

test("validateSpec accepts well-formed specs, rejects malformed", () => {
  assert.equal(validateSpec(bgMedia).ok, true);
  assert.equal(validateSpec(timer).ok, true);
  assert.equal(validateSpec(msg).ok, true);
  assert.equal(validateSpec({ type: "timer", timerId: "bad id!", command: "start" }).ok, false);
  assert.equal(validateSpec({ type: "show_message", text: "" }).ok, false);
  assert.equal(validateSpec({ type: "nope" }).ok, false);
  assert.equal(validateSpec(null).ok, false);
  assert.equal(validateSpec({ type: "set_background_media", assetRef: { id: 1 } }).ok, false);
});

test("guarded specs are identified and excluded from slides", () => {
  for (const g of [kill, blank, clearAll]) {
    assert.equal(isGuardedSpec(g), true, `${g.type} guarded`);
    const r = validateForSlide(g);
    assert.equal(r.ok, false, `${g.type} not allowed on slide`);
    assert.equal(r.reason, "guarded-not-allowed-on-slide");
  }
  assert.equal(isGuardedSpec(timer), false);
  assert.equal(validateForSlide(timer).ok, true);
});

test("macro allowed on slides but NOT inside macros (no recursion)", () => {
  assert.equal(validateForSlide(macroRef).ok, true, "macro allowed as slide action");
  const r = validateForMacro(macroRef);
  assert.equal(r.ok, false, "macro-in-macro forbidden");
  assert.equal(r.reason, "no-macro-in-macro");
  // guarded IS allowed inside a macro
  assert.equal(validateForMacro(kill).ok, true);
});

test("specToEngineAction maps to the right EngineAction (null for macro)", () => {
  assert.deepEqual(specToEngineAction(timer), { type: "TIMER_COMMAND", timerId: "default", command: "start" });
  assert.deepEqual(specToEngineAction(clearLayer), { type: "CLEAR_LAYER", id: "background" });
  assert.deepEqual(specToEngineAction(kill), { type: "KILL" });
  assert.equal(specToEngineAction(macroRef), null);
});

test("validateSlideActions: array + cap + per-item", () => {
  assert.equal(validateSlideActions([timer, msg]).ok, true);
  assert.equal(validateSlideActions("nope").ok, false);
  assert.equal(validateSlideActions(new Array(MAX_SLIDE_ACTIONS + 1).fill(timer)).ok, false);
  const bad = validateSlideActions([timer, kill]);
  assert.equal(bad.ok, false);
  assert.equal(bad.index, 1);
});

test("sanitizeSlideActions drops guarded/invalid, keeps valid, caps", () => {
  const out = sanitizeSlideActions([timer, kill, { type: "junk" }, msg]);
  assert.deepEqual(out, [timer, msg]);
  assert.equal(sanitizeSlideActions(new Array(20).fill(timer)).length, MAX_SLIDE_ACTIONS);
});

test("dispatchSlideActions fires EVERY spec confirmed:false, incl. macro expansions (slide invariant)", () => {
  const calls: { action: EngineAction; confirmed?: boolean }[] = [];
  const dispatch: DispatchEngineAction = (action, opts) => { calls.push({ action, confirmed: opts?.confirmed }); return { handled: true }; };
  const macro: MacroDefinition = { id: "m1", churchId: "c", name: "M", enabled: true, actions: [kill, timer] };
  const outcomes = dispatchSlideActions(dispatch, [timer, macroRef], () => macro);
  // timer (confirmed:false) + macro expands to kill + timer — ALL confirmed:false.
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].action, { type: "TIMER_COMMAND", timerId: "default", command: "start" });
  for (const c of calls) assert.equal(c.confirmed, false, `every slide-action dispatch must be confirmed:false (${c.action.type})`);
  assert.deepEqual(calls[1].action, { type: "KILL" });
  assert.equal(outcomes.length, 3);
});

test("SAFETY: a guarded action inside a macro attached to a slide is REFUSED at dispatch (projector never yanked)", () => {
  // Real dispatchAction + a fake ctx: if a guarded action fired, these push.
  const fired: string[] = [];
  const ctx = { onKill: () => fired.push("KILL"), onTimerCommand: () => fired.push("TIMER"), liveLayers: { clearAll: () => fired.push("CLEAR_ALL"), rows: [] } } as unknown as Parameters<typeof dispatchAction>[0];
  const dispatch: DispatchEngineAction = (action, opts) => dispatchAction(ctx, action, opts);
  const macro: MacroDefinition = { id: "m1", churchId: "c", name: "Danger", enabled: true, actions: [kill, { type: "clear_all_layers" }, timer] };
  const outcomes = dispatchSlideActions(dispatch, [macroRef], () => macro);
  // kill + clear_all refused-guard, timer handled — nothing destructive ran.
  assert.deepEqual(fired, ["TIMER"], "only the non-destructive action fires; no KILL/CLEAR_ALL from a slide send");
  const reasons = outcomes.map((o) => o.result.reason ?? (o.result.handled ? "handled" : "?"));
  assert.deepEqual(reasons, ["refused-guard", "refused-guard", "handled"]);
});

test("dispatchSlideActions reports macro-not-found", () => {
  const dispatch: DispatchEngineAction = () => ({ handled: true });
  const outcomes = dispatchSlideActions(dispatch, [macroRef], () => null);
  assert.equal(outcomes.length, 1);
  assert.deepEqual(outcomes[0].result, { handled: false, reason: "macro-not-found" });
});
