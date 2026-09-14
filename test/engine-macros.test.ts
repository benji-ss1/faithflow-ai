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

test("executeMacro isolates a throwing handler — sequence continues", () => {
  const seen: string[] = [];
  const dispatch: DispatchEngineAction = (a) => {
    const label = (a as { text?: string }).text ?? a.type;
    seen.push(label);
    if (label === "boom") throw new Error("handler blew up");
    return { handled: true };
  };
  const out = executeMacro(mac([{ type: "show_message", text: "a" }, { type: "show_message", text: "boom" }, { type: "show_message", text: "b" }]), dispatch, { confirmed: false });
  assert.deepEqual(seen, ["a", "boom", "b"]); // b still fired
  assert.equal(out[1].result.handled, false);
  assert.equal(out[1].result.reason, "threw");
  assert.equal(out[2].result.handled, true);
});

// ── Review-fix hardening: defensive re-sanitize in the runner ──
test("macroToEngineActions / executeMacro re-apply caps + shape validation defensively", () => {
  // A corrupted/client-cached definition: invalid specs, extra keys, over the count cap.
  const corrupt = mac([
    { type: "timer", timerId: "bad id!", command: "start" } as unknown as ActionSpec,
    { ...timer, junk: "x" } as unknown as ActionSpec,
    ...new Array(MAX_ACTIONS_PER_MACRO + 5).fill(msg),
  ]);
  const eas = macroToEngineActions(corrupt);
  assert.equal(eas.length, MAX_ACTIONS_PER_MACRO, "count cap re-applied");
  assert.deepEqual(eas[0], { type: "TIMER_COMMAND", timerId: "t1", command: "start" });
  const seen: EngineAction[] = [];
  const out = executeMacro(corrupt, (a) => { seen.push(a); return { handled: true }; });
  assert.equal(out.length, MAX_ACTIONS_PER_MACRO);
  // Non-array actions / null def never throw.
  assert.deepEqual(macroToEngineActions({ ...mac([]), actions: "x" as unknown as ActionSpec[] }), []);
  assert.deepEqual(executeMacro(null as unknown as MacroDefinition, () => ({ handled: true })), []);
});

test("sanitizeMacroActions strips extra keys, keeps guarded, drops macro refs", () => {
  const out = sanitizeMacroActions([{ ...kill, x: 1 }, macroRef, { ...msg, __proto__x: 2 }]);
  assert.deepEqual(out, [kill, msg]);
});

test("executeMacro: confirmed must be exactly true to pass confirmed:true", () => {
  const got: (boolean | undefined)[] = [];
  executeMacro(mac([kill]), (_a, o) => { got.push(o?.confirmed); return { handled: true }; }, { confirmed: "yes" as unknown as boolean });
  assert.deepEqual(got, [false]);
});
