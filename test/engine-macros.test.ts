/**
 * engine/macros tests. Run: npx tsx --test test/engine-macros.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateMacroActions, sanitizeMacroActions, executeMacro, macroToEngineActions,
  macroHasGuardedAction, MAX_ACTIONS_PER_MACRO, type MacroDefinition, type DispatchEngineAction,
} from "../src/engine/macros";
import type { ActionSpec } from "../src/engine/actions/spec";
import type { EngineAction } from "../src/engine/actions";

const timer: ActionSpec = { type: "timer", timerId: "t1", command: "start" };
const msg: ActionSpec = { type: "show_message", text: "hi" };
const kill: ActionSpec = { type: "kill" };
const macroRef: ActionSpec = { type: "macro", macroId: "x" };

function mac(actions: ActionSpec[], enabled = true): MacroDefinition {
  return { id: "m", churchId: "c", name: "M", enabled, actions };
}

test("validateMacroActions: array, cap, no macro-in-macro", () => {
  assert.equal(validateMacroActions([timer, msg, kill]).ok, true, "guarded allowed in macro");
  assert.equal(validateMacroActions("x").ok, false);
  assert.equal(validateMacroActions(new Array(MAX_ACTIONS_PER_MACRO + 1).fill(timer)).ok, false);
  const r = validateMacroActions([timer, macroRef]);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no-macro-in-macro");
  assert.equal(r.index, 1);
});

test("sanitizeMacroActions drops macro refs + invalid, keeps guarded", () => {
  assert.deepEqual(sanitizeMacroActions([timer, macroRef, { type: "junk" }, kill]), [timer, kill]);
});

test("macroToEngineActions maps + skips stray macro refs", () => {
  const eas = macroToEngineActions(mac([timer, msg]));
  assert.deepEqual(eas, [
    { type: "TIMER_COMMAND", timerId: "t1", command: "start" },
    { type: "SEND_MESSAGE", text: "hi", dismissAfterMs: null },
  ]);
});

test("macroHasGuardedAction detects destructive contents", () => {
  assert.equal(macroHasGuardedAction(mac([timer, msg])), false);
  assert.equal(macroHasGuardedAction(mac([timer, kill])), true);
});

test("executeMacro gates guarded actions on confirmed flag", () => {
  const calls: { a: EngineAction; confirmed?: boolean }[] = [];
  const dispatch: DispatchEngineAction = (a, o) => {
    calls.push({ a, confirmed: o?.confirmed });
    // simulate the real dispatcher refusing a guarded action without confirm
    if (a.type === "KILL" && !o?.confirmed) return { handled: false, reason: "refused-guard" };
    return { handled: true };
  };
  // unconfirmed → kill refused
  const r1 = executeMacro(mac([timer, kill]), dispatch, { confirmed: false });
  assert.equal(r1[1].result.reason, "refused-guard");
  // confirmed → kill fires
  const r2 = executeMacro(mac([timer, kill]), dispatch, { confirmed: true });
  assert.equal(r2[1].result.handled, true);
});

test("disabled macro executes nothing", () => {
  const dispatch: DispatchEngineAction = () => ({ handled: true });
  assert.deepEqual(executeMacro(mac([timer], false), dispatch, { confirmed: true }), []);
});
