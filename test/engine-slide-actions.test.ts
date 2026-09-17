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

// ── Review-fix hardening ──
test("sanitizeSlideActions strips extra keys and 5MB junk (whitelist rebuild)", () => {
  const out = sanitizeSlideActions([{ ...timer, pad: "x".repeat(5 * 1024 * 1024), __evil: {} }, { ...msg, extra: 1 }]);
  assert.deepEqual(out, [timer, msg]);
  assert.ok(JSON.stringify(out).length < 200);
});

test("validate/sanitizeSlideActions enforce the 32KB serialized list cap", () => {
  const big = Array.from({ length: MAX_SLIDE_ACTIONS }, () => ({ type: "show_message", text: "z".repeat(2000) }));
  const v = validateSlideActions(big);
  assert.ok(v.ok, "8 x 2000 chars is under 32KB");
  const bigger = Array.from({ length: MAX_SLIDE_ACTIONS }, (_, i) => ({ type: "show_message", text: "z".repeat(2000), dismissAfterMs: i }));
  assert.ok(validateSlideActions(bigger).ok);
  // Force over the cap with announcements (~1KB embedded each).
  // NOTE: this used to inflate the payload with a 3000-char style.fontFamily,
  // but Fonts P1 (2026-09-17) holds announcement fontFamily to the same
  // 120-char FONT_FAMILY_RE as every other font-family on the wire, so that
  // payload is now correctly rejected as "bad-announcement" BEFORE the byte cap
  // is reached. Use legal-but-long fields so this still tests the byte cap it is
  // named for. (A separate case below pins the fontFamily rejection itself.)
  const ann = { type: "set_announcement", announcement: { line1: "a".repeat(500), line2: "b".repeat(500), position: "lower_third", style: { fontFamily: "f".repeat(120), bgColor: "c".repeat(3000) } } };
  const list = Array.from({ length: MAX_SLIDE_ACTIONS }, () => ann);
  assert.equal(validateSlideActions(list).reason, "too-large");
  const s = sanitizeSlideActions(list);
  assert.ok(JSON.stringify(s).length <= 32 * 1024, "sanitize trims to the byte cap");
  assert.ok(s.length < MAX_SLIDE_ACTIONS);
});

test("announcement style.fontFamily is held to the wire font-family rules (Fonts P1)", () => {
  const withFont = (fontFamily: unknown) => [{
    type: "set_announcement",
    announcement: { line1: "Welcome", position: "lower_third", style: { fontFamily } },
  }];
  // Reaches CSS, so it must obey the same charset + 120-char cap as every other
  // font-family on the wire — no CSS punctuation, no unbounded length.
  for (const bad of ["f".repeat(121), "Sora; } body{display:none}", "Inter<script>", "url(evil)", "a\nb"]) {
    assert.equal(validateSlideActions(withFont(bad)).ok, false, `should reject ${JSON.stringify(bad).slice(0, 40)}`);
  }
  // Real values — plain families and full stacks — still pass untouched.
  for (const good of ["Sora", "Playfair Display", "Times New Roman, serif", "Sora, Inter, sans-serif", undefined]) {
    assert.equal(validateSlideActions(withFont(good)).ok, true, `should accept ${String(good)}`);
  }
});

test("dispatchAction: confirmed must be === true (truthy non-boolean refused)", () => {
  const fired: string[] = [];
  const ctx = { onKill: () => fired.push("KILL") } as unknown as Parameters<typeof dispatchAction>[0];
  for (const c of ["yes", 1, {}, "true"]) {
    const r = dispatchAction(ctx, { type: "KILL" }, { confirmed: c as unknown as boolean });
    assert.deepEqual(r, { handled: false, reason: "refused-guard" }, `confirmed=${JSON.stringify(c)}`);
  }
  assert.deepEqual(fired, []);
  assert.deepEqual(dispatchAction(ctx, { type: "KILL" }, { confirmed: true }), { handled: true });
});

test("dispatchSlideActions: a throwing resolveMacro becomes macro-not-found and the rest still fire", () => {
  const calls: string[] = [];
  const dispatch: DispatchEngineAction = (a) => { calls.push(a.type); return { handled: true }; };
  const outcomes = dispatchSlideActions(dispatch, [macroRef, timer], () => { throw new Error("boom"); });
  assert.deepEqual(outcomes[0].result, { handled: false, reason: "macro-not-found" });
  assert.deepEqual(calls, ["TIMER_COMMAND"]);
});
