/**
 * Timer per-screen routing (Phase 1, 2026-09-21).
 *
 * Locks the contract that lets an operator choose WHICH outputs a timer shows on
 * (Projector / Stage / Livestream / NDI, any combination) by adding "timer" to the
 * Scenes layer matrix. "timer" is a ROUTE-DRAWN layer: the compositor never sees
 * it, so each output route applies the mask itself — exactly like "announcement".
 *
 * The load-bearing no-regression property is DEFAULT-OFF: with no scene, or a
 * scene that says nothing about timers, sceneHidesLayer must be false everywhere,
 * so a church that never opens the Scene Builder sees no change at all.
 *
 * Run: npx tsx --test test/timer-scene-routing.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SCENE_LAYER_IDS,
  SCENE_LAYER_LABELS,
  SCENE_SCREENS,
  sceneHidesLayer,
  sanitizeSceneConfig,
  BUILT_IN_SCENES,
  type SceneConfig,
  type SceneWire,
} from "../src/lib/scenes";

const wire = (cfg: SceneConfig): SceneWire => ({ id: "t", name: "T", screens: cfg.screens });

test("\"timer\" is a routable layer with a label", () => {
  assert.ok(SCENE_LAYER_IDS.includes("timer"), "timer must be routable");
  assert.equal(SCENE_LAYER_LABELS.timer, "Timer");
});

test("all four outputs are targetable", () => {
  assert.deepEqual(SCENE_SCREENS, ["main", "stage", "livestream", "ndi"]);
});

test("NO REGRESSION: no scene ⇒ timers hidden nowhere", () => {
  for (const screen of SCENE_SCREENS) {
    assert.equal(sceneHidesLayer(null, screen, "timer"), false, `null scene must not hide on ${screen}`);
    assert.equal(sceneHidesLayer(undefined, screen, "timer"), false, `undefined scene must not hide on ${screen}`);
  }
});

test("NO REGRESSION: a scene silent about timers hides no timer", () => {
  const s = wire(sanitizeSceneConfig({ screens: { stage: { layers: { background: false } } } }));
  for (const screen of SCENE_SCREENS) {
    assert.equal(sceneHidesLayer(s, screen, "timer"), false);
  }
});

test("NO REGRESSION: no built-in scene hides timers", () => {
  for (const b of BUILT_IN_SCENES) {
    for (const screen of SCENE_SCREENS) {
      assert.equal(
        sceneHidesLayer(wire(b.config), screen, "timer"), false,
        `built-in "${b.id}" must not hide the timer on ${screen}`,
      );
    }
  }
});

test("hiding the timer on ONE screen leaves the others untouched", () => {
  const s = wire(sanitizeSceneConfig({ screens: { livestream: { layers: { timer: false } } } }));
  assert.equal(sceneHidesLayer(s, "livestream", "timer"), true);
  assert.equal(sceneHidesLayer(s, "main", "timer"), false);
  assert.equal(sceneHidesLayer(s, "stage", "timer"), false);
  assert.equal(sceneHidesLayer(s, "ndi", "timer"), false);
});

test("multi-select: any combination of outputs round-trips through sanitize", () => {
  // Every subset of the four screens must survive sanitize exactly.
  for (let mask = 0; mask < 1 << SCENE_SCREENS.length; mask++) {
    const hidden = SCENE_SCREENS.filter((_, i) => mask & (1 << i));
    const screens: SceneConfig["screens"] = {};
    for (const sc of hidden) screens[sc] = { layers: { timer: false } };
    const s = wire(sanitizeSceneConfig({ screens }));
    for (const sc of SCENE_SCREENS) {
      assert.equal(
        sceneHidesLayer(s, sc, "timer"), hidden.includes(sc),
        `subset [${hidden.join(",")}] wrong for ${sc}`,
      );
    }
  }
});

test("hiding the timer does not hide any other layer on that screen", () => {
  const s = wire(sanitizeSceneConfig({ screens: { main: { layers: { timer: false } } } }));
  for (const layer of SCENE_LAYER_IDS) {
    if (layer === "timer") continue;
    assert.equal(sceneHidesLayer(s, "main", layer), false, `${layer} must be untouched`);
  }
});

test("timer:true is an explicit SHOW, never a hide", () => {
  const s = wire(sanitizeSceneConfig({ screens: { stage: { layers: { timer: true } } } }));
  assert.equal(sceneHidesLayer(s, "stage", "timer"), false);
});

test("a junk timer mask value is dropped, and never hides (fail-open)", () => {
  const cfg = sanitizeSceneConfig({ screens: { main: { layers: { timer: "nope" } } } } as unknown as SceneConfig);
  assert.equal(sceneHidesLayer(wire(cfg), "main", "timer"), false);
});
