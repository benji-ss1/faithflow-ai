/**
 * engine/actions tests — dispatchAction mapping completeness.
 *
 * Every EngineAction variant must EITHER dispatch to the real ctx/liveLayers
 * method named in ACTION_BINDINGS (verified via a recording mock ctx) OR be
 * explicitly declared engine-only / todo-wired (verified to be a no-op).
 *
 * Run: npx tsx --test test/engine-actions.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dispatchAction,
  ACTION_BINDINGS,
  type EngineAction,
  type EngineActionType,
} from "../src/engine/actions";
import type { OperatorShellCtx } from "../src/components/operator/shell/types";
import type { SlidePayload } from "../src/lib/broadcast";

const slide: SlidePayload = { kind: "text", text: "hi" };

// One representative action per union member.
const SAMPLES: Record<EngineActionType, EngineAction> = {
  GO_SLIDE: { type: "GO_SLIDE", itemIdx: 1, slideIdx: 2 },
  SET_PREVIEW_ITEM: { type: "SET_PREVIEW_ITEM", itemIdx: 3 },
  SEND_TO_LIVE: { type: "SEND_TO_LIVE" },
  SEND_SLIDE_TO_LIVE: { type: "SEND_SLIDE_TO_LIVE", slide },
  STAGE_SLIDE: { type: "STAGE_SLIDE", slide },
  CLEAR_SLIDE: { type: "CLEAR_SLIDE" },
  CLEAR_MEDIA: { type: "CLEAR_MEDIA" },
  CLEAR_LOWER_THIRD: { type: "CLEAR_LOWER_THIRD" },
  BLANK: { type: "BLANK" },
  LOGO: { type: "LOGO" },
  KILL: { type: "KILL" },
  SEND_MESSAGE: { type: "SEND_MESSAGE", text: "hello" },
  CLEAR_MESSAGE: { type: "CLEAR_MESSAGE" },
  SEND_LOWER_THIRD: { type: "SEND_LOWER_THIRD", line1: "a", line2: "b" },
  SET_ANNOUNCEMENT: { type: "SET_ANNOUNCEMENT", announcement: null },
  SET_TRANSITION: { type: "SET_TRANSITION", transition: null },
  START_COUNTDOWN: { type: "START_COUNTDOWN", seconds: 300 },
  OPEN_PROJECTOR: { type: "OPEN_PROJECTOR" },
  OPEN_STAGE: { type: "OPEN_STAGE" },
  OPEN_STREAM: { type: "OPEN_STREAM" },
  CLEAR_LAYER: { type: "CLEAR_LAYER", id: "slide" },
  CLEAR_ALL_LAYERS: { type: "CLEAR_ALL_LAYERS" },
  SET_LAYER_VISIBILITY: { type: "SET_LAYER_VISIBILITY", id: "slide", enabled: false },
  SET_BACKGROUND: { type: "SET_BACKGROUND", spec: null },
  SET_BACKGROUND_MEDIA: {
    type: "SET_BACKGROUND_MEDIA",
    assetRef: { id: "a1", url: "https://x/y.jpg", fileName: "y.jpg", kind: "image" },
  },
  TRIGGER_MACRO: { type: "TRIGGER_MACRO", macroId: "m1" },
  SET_LOOK: { type: "SET_LOOK", lookId: "l1" },
  TOGGLE_PROP: { type: "TOGGLE_PROP", propId: "p1", visible: true },
};

/** Build a mock ctx that records which ctx methods + liveLayers methods fire. */
function makeCtx() {
  const ctxCalls: string[] = [];
  const layerCalls: string[] = [];
  const rec = (bucket: string[], name: string) => (..._a: unknown[]) => { bucket.push(name); };

  const liveLayers = {
    // one layer "slide", currently enabled → SET_LAYER_VISIBILITY{enabled:false} toggles
    rows: [{ id: "slide", kind: "slide", z: 20, enabled: true, opacity: 1, zone: { kind: "full" }, active: true, overridden: false }],
    overrides: [],
    epoch: 0,
    enabled: true,
    clearLayer: rec(layerCalls, "clearLayer"),
    toggleLayer: rec(layerCalls, "toggleLayer"),
    setZone: rec(layerCalls, "setZone"),
    setOpacity: rec(layerCalls, "setOpacity"),
    swapBackground: rec(layerCalls, "swapBackground"),
    clearAll: rec(layerCalls, "clearAll"),
    rearmSlide: rec(layerCalls, "rearmSlide"),
    reset: rec(layerCalls, "reset"),
  };

  // Proxy records any ctx handler call by property name.
  const ctx = new Proxy(
    { liveLayers } as Record<string, unknown>,
    {
      get(target, prop: string) {
        if (prop === "liveLayers") return liveLayers;
        return rec(ctxCalls, prop);
      },
    },
  ) as unknown as OperatorShellCtx;

  return { ctx, ctxCalls, layerCalls };
}

test("every EngineAction type has a binding and a sample", () => {
  for (const t of Object.keys(ACTION_BINDINGS) as EngineActionType[]) {
    assert.ok(SAMPLES[t], `missing sample for ${t}`);
  }
  // No stray samples beyond the bindings.
  for (const t of Object.keys(SAMPLES) as EngineActionType[]) {
    assert.ok(ACTION_BINDINGS[t], `sample ${t} has no binding`);
  }
});

test("ctx-bound actions call their named handler", () => {
  for (const [t, binding] of Object.entries(ACTION_BINDINGS) as [EngineActionType, typeof ACTION_BINDINGS[EngineActionType]][]) {
    if (binding.mode !== "ctx") continue;
    const { ctx, ctxCalls } = makeCtx();
    dispatchAction(ctx, SAMPLES[t]);
    assert.deepEqual(ctxCalls, [binding.method], `${t} → ctx.${binding.method}`);
  }
});

test("layer-bound actions call their named liveLayers method", () => {
  for (const [t, binding] of Object.entries(ACTION_BINDINGS) as [EngineActionType, typeof ACTION_BINDINGS[EngineActionType]][]) {
    if (binding.mode !== "layers") continue;
    const { ctx, layerCalls, ctxCalls } = makeCtx();
    dispatchAction(ctx, SAMPLES[t]);
    assert.deepEqual(layerCalls, [binding.method], `${t} → liveLayers.${binding.method}`);
    assert.equal(ctxCalls.length, 0, `${t} must not touch other ctx handlers`);
  }
});

test("SET_LAYER_VISIBILITY is idempotent (no toggle when already at target)", () => {
  const { ctx, layerCalls } = makeCtx();
  // rows has slide enabled:true; request enabled:true → NO toggle.
  dispatchAction(ctx, { type: "SET_LAYER_VISIBILITY", id: "slide", enabled: true });
  assert.deepEqual(layerCalls, [], "no toggle when state already matches");
});

test("engine-only + todo-wired actions are no-ops on ctx", () => {
  for (const [t, binding] of Object.entries(ACTION_BINDINGS) as [EngineActionType, typeof ACTION_BINDINGS[EngineActionType]][]) {
    if (binding.mode !== "engine-only" && binding.mode !== "todo-wired") continue;
    const { ctx, ctxCalls, layerCalls } = makeCtx();
    dispatchAction(ctx, SAMPLES[t]);
    assert.equal(ctxCalls.length, 0, `${t} must not call ctx`);
    assert.equal(layerCalls.length, 0, `${t} must not call liveLayers`);
  }
});
