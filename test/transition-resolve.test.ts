/**
 * Theme → Projector (PR 2) — transition resolution (decision 3) + theme
 * transition normalisation + a drift guard for the transition name catalog.
 *
 * Run: npx tsx test/transition-resolve.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeThemeTransition, resolveSendTransition, readOperatorTransitionsOff } from "../src/lib/transition-resolve";
import { TRANSITION_NAME_TO_EFFECT_ID, TRANSITION_KEY } from "../src/lib/transition-names";
import { AI_AUTO_TRANSITION, ALLOWED_TRANSITION_NAMES, isValidTransitionSpec, type TransitionSpec } from "../src/lib/broadcast";
import { getEffect } from "../src/lib/effects";
import { TRANSITIONS } from "../src/components/operator/pro/BottomBar/TransitionChooser";
import * as BottomBarMod from "../src/components/operator/pro/BottomBar";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}

const OP: TransitionSpec = { effectId: "slide_right", durationMs: 800, easing: "ease-in-out", name: "Push" };
const THEME: TransitionSpec = { effectId: "cross_fade", durationMs: 400, easing: "ease-in-out", name: "Dissolve" };

console.log("resolveSendTransition precedence matrix:");
const bools = [false, true];
const themes: (TransitionSpec | null | undefined)[] = [undefined, null, THEME];
const ops: (TransitionSpec | null)[] = [null, OP];
for (const instant of bools) for (const aiAuto of bools) for (const operatorOff of bools) for (const themeTransition of themes) for (const operatorSpec of ops) {
  const expected = instant ? null : aiAuto ? AI_AUTO_TRANSITION : operatorOff ? null : themeTransition !== undefined ? themeTransition : operatorSpec;
  check(`i=${+instant} ai=${+aiAuto} off=${+operatorOff} theme=${themeTransition === undefined ? "none" : themeTransition ? "spec" : "cut"} op=${operatorSpec ? "spec" : "null"}`, () => {
    assert.deepEqual(resolveSendTransition({ instant, aiAuto, operatorOff, themeTransition, operatorSpec }), expected);
  });
}
check("no theme transition → exactly the operator's (legacy behaviour)", () => {
  assert.equal(resolveSendTransition({ operatorSpec: OP }), OP);
  assert.equal(resolveSendTransition({ operatorSpec: null }), null);
});

console.log("normalizeThemeTransition:");
check("no transition set → undefined (falls through)", () => {
  assert.equal(normalizeThemeTransition({}), undefined);
  assert.equal(normalizeThemeTransition(null), undefined);
  assert.equal(normalizeThemeTransition({ transitionType: "fade", transitionDurationMs: 300 }), undefined, "legacy ThemesManager pair is not a transition");
});
check("PR 1 saved shape (effectId = display name) repaired to a real effect id", () => {
  assert.deepEqual(normalizeThemeTransition({ transition: { effectId: "Fade", name: "Fade", durationMs: 500, easing: "ease-in-out" } }),
    { effectId: "fade_in", durationMs: 500, easing: "ease-in-out", name: "Fade" });
  assert.deepEqual(normalizeThemeTransition({ transition: { effectId: "Slide (L→R)", durationMs: 250 } }),
    { effectId: "slide_right", durationMs: 250, easing: "ease-in-out", name: "Slide (L→R)" });
});
check("Cut → null (explicit hard cut)", () => {
  assert.equal(normalizeThemeTransition({ transition: { effectId: "Cut", name: "Cut", durationMs: 300 } }), null);
  assert.equal(normalizeThemeTransition({ transition: { effectId: "cut", name: "Cut", durationMs: 300 } }), null);
});
check("real effect id without a name → whitelisted name found", () => {
  assert.deepEqual(normalizeThemeTransition({ transition: { effectId: "cross_fade", durationMs: 300 } }),
    { effectId: "cross_fade", durationMs: 300, easing: "ease-in-out", name: "Dissolve" });
});
check("clamp 0..5000, transitionDurationMs fallback, bad easing replaced", () => {
  assert.equal(normalizeThemeTransition({ transition: { name: "Fade", durationMs: 99999 } })?.durationMs, 5000);
  assert.equal(normalizeThemeTransition({ transition: { name: "Fade", durationMs: -4 } })?.durationMs, 0);
  assert.equal(normalizeThemeTransition({ transition: { name: "Fade" }, transitionDurationMs: 700 })?.durationMs, 700);
  assert.equal(normalizeThemeTransition({ transition: { name: "Fade" } })?.durationMs, 300);
  assert.equal(normalizeThemeTransition({ transition: { name: "Fade", easing: "x;}{" } })?.easing, "ease-in-out");
});
check("unknown / hostile → undefined (never an invalid wire spec)", () => {
  assert.equal(normalizeThemeTransition({ transition: { effectId: "evil", name: "Evil" } }), undefined);
  assert.equal(normalizeThemeTransition({ transition: { effectId: "type_on" } }), undefined, "real id with no whitelisted name");
  assert.equal(normalizeThemeTransition({ transition: "Fade" }), undefined);
  assert.equal(normalizeThemeTransition({ transition: [1] }), undefined);
});
check("every normalised spec passes isValidTransitionSpec", () => {
  for (const name of Object.keys(TRANSITION_NAME_TO_EFFECT_ID)) {
    const n = normalizeThemeTransition({ transition: { effectId: name, name, durationMs: 400 } });
    if (n !== null) assert.ok(n && isValidTransitionSpec(n), name);
  }
});

console.log("Drift guard:");
check("every TRANSITIONS name is whitelisted AND mapped to a real effect (or null for Cut)", () => {
  for (const name of TRANSITIONS) {
    assert.ok(ALLOWED_TRANSITION_NAMES.has(name), `${name} not whitelisted`);
    assert.ok(Object.prototype.hasOwnProperty.call(TRANSITION_NAME_TO_EFFECT_ID, name), `${name} not mapped`);
    const id = TRANSITION_NAME_TO_EFFECT_ID[name];
    if (id !== null) assert.ok(getEffect(id), `${name} → ${id} is not a real effect`);
  }
});
check("BottomBar still re-exports the moved constants (no import breakage)", () => {
  assert.equal(BottomBarMod.TRANSITION_NAME_TO_EFFECT_ID, TRANSITION_NAME_TO_EFFECT_ID);
  assert.equal(BottomBarMod.TRANSITION_KEY, TRANSITION_KEY);
  assert.equal(TRANSITION_KEY, "presentflow.pro.transition.v1");
});

console.log("Operator Off switch read at send time:");
check("reads {off} from TRANSITION_KEY; missing / corrupt → false", () => {
  assert.equal(readOperatorTransitionsOff(), false, "no window");
  const store = new Map<string, string>();
  (globalThis as unknown as { window: unknown }).window = { localStorage: { getItem: (k: string) => store.get(k) ?? null } };
  try {
    assert.equal(readOperatorTransitionsOff(), false);
    store.set(TRANSITION_KEY, JSON.stringify({ name: "Fade", durationMs: 300, off: true }));
    assert.equal(readOperatorTransitionsOff(), true);
    store.set(TRANSITION_KEY, JSON.stringify({ name: "Fade", durationMs: 300, off: false }));
    assert.equal(readOperatorTransitionsOff(), false);
    store.set(TRANSITION_KEY, "{not json");
    assert.equal(readOperatorTransitionsOff(), false);
  } finally {
    delete (globalThis as unknown as { window?: unknown }).window;
  }
});

console.log("Send-path wiring invariants (OperatorConsole source):");
{
  const src = readFileSync(new URL("../src/components/operator/OperatorConsole.tsx", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("const sendSlideToLive = useCallback("), src.indexOf("const stageSlide = useCallback("));
  check("resolved once, AFTER the already-live skip", () => {
    const skip = body.indexOf("slideOutputIdentity(slide) === slideOutputIdentity(liveRef.current)");
    const resolve = body.indexOf("resolveSendTransition(");
    assert.ok(skip > 0 && resolve > skip);
    assert.equal(body.split("resolveSendTransition(").length - 1, 1);
  });
  check("sticky marker set for EVERY send with the resolved transition", () => {
    assert.ok(body.includes("fastTransitionSlideRef.current = { slide, transition: resolvedTransition };"));
    assert.ok(!body.includes("fastTransitionSlideRef.current = { slide, transition: null };"), "no separate instant-only marker");
  });
  check("\"set\" always carries transition (incl. null)", () => {
    assert.ok(body.includes('postMessage({ type: "set", slide, transition: resolvedTransition }'));
  });
  check("instant → AI → Off → theme → operator inputs wired", () => {
    assert.ok(body.includes("instant: options?.instant"));
    assert.ok(body.includes("aiAuto: options?.preserveConfiguredTransition"));
    assert.ok(body.includes("readOperatorTransitionsOff()"));
    assert.ok(body.includes("themeTransitionFor(slide, sendItem)"));
    assert.ok(body.includes("transitionSpecRef.current"));
  });
  check("OutputState heartbeat + stage fallback use the sticky marker", () => {
    assert.ok(src.includes("transition: useFastTransition ? fastMarker!.transition : transitionSpec"));
    assert.ok(src.includes("transition: fastTransitionSlideRef.current?.slide === live ? fastTransitionSlideRef.current.transition : transitionSpec"));
  });
}

console.log(`\ntransition-resolve: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
