/**
 * MultiView (2026-09-15) — per-screen preview resolution must mirror each output
 * route's OutputCompositor inputs, stay read-only (no camera, no transition, frozen
 * background), and fail safe on junk state.
 *
 * Run: npx tsx test/multiview.test.ts
 */
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { OutputState } from "../src/lib/broadcast";
import { DEFAULT_OBS_BAND } from "../src/lib/obs-lowerthird";
import { DEFAULT_OBS_LOOK_SETTINGS, type ObsEditorStore } from "../src/lib/obs-look";

(globalThis as unknown as { React: typeof React }).React = React;

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}

async function main() {
  const mv = await import("../src/lib/multiview");
  const { OutputCompositor } = await import("../src/components/live/OutputCompositor");

  const state = {
    live: { kind: "text", text: "For God so loved the world", reference: "John 3:16 (KJV)" },
    next: { kind: "text", text: "that he gave his only begotten Son" },
    itemTitle: "Sermon", slideNumber: "1 / 3",
    aspectRatio: "16:9", fitMode: "contain", safeArea: false,
    fontScale: 1.2, referenceScale: 0.9, referenceColor: "#ffcc00",
    operatorMessage: "Wrap up in 5", lowerThird: { line1: "Pastor Ade", line2: "Lead Pastor" },
    countdownEndsAt: null,
    background: { type: "none" },
    appearance: null,
    videoInput: { deviceId: "cam-1" },
  } as unknown as OutputState;
  const store = (look: ObsEditorStore["look"]): ObsEditorStore => ({ v: 2, look, lookLive: true, band: DEFAULT_OBS_BAND, settings: DEFAULT_OBS_LOOK_SETTINGS });
  const opts = { layersEnabled: false };

  check("every screen is read-only: no camera stream, no transition, frozen, muted", () => {
    for (const s of mv.MULTIVIEW_SCREENS) {
      const v = mv.resolveScreenView(s, state, { ...opts, obsStore: store("full") });
      assert.equal(v.props.videoInput, null, `${s} must not open a camera`);
      assert.equal(v.props.transition, null, `${s} must not animate`);
      assert.equal(v.props.previewFrozen, true, `${s} must freeze background`);
      assert.equal(v.props.videoMuted, true, `${s} must be muted`);
      assert.equal(v.props.onVideoRef, undefined, `${s} must not steal the preview video ref`);
    }
  });

  check("main mirrors /live fields (zone, aspect, scales, colour)", () => {
    const v = mv.resolveScreenView("main", state, opts);
    assert.equal(v.props.mode, "live");
    assert.equal(v.props.fontScale, 1.2);
    assert.equal(v.props.referenceScale, 0.9);
    assert.equal(v.props.referenceColor, "#ffcc00");
    assert.equal(v.props.aspectRatio, "16:9");
    assert.equal(v.cameraHidden, true, "camera badge shown when the live output uses a camera");
  });

  check("stage carries next slide + operator message, never a camera", () => {
    const v = mv.resolveScreenView("stage", state, opts);
    assert.equal(v.props.mode, "stage");
    assert.deepEqual(v.stage?.next, state.next);
    assert.equal(v.stage?.operatorMessage, "Wrap up in 5");
    assert.equal(v.cameraHidden, false);
  });

  check("ndi defaults to transparent graphics (route default)", () => {
    const v = mv.resolveScreenView("ndi", state, opts);
    assert.equal(v.props.mode, "ndi");
    assert.equal(v.props.transparent, true);
  });

  check("livestream follows the OBS editor look", () => {
    const cam = mv.resolveScreenView("livestream", state, { ...opts, obsStore: store("camera") });
    assert.equal(cam.props.transparent, true);
    assert.equal(cam.detail, "Over camera");
    const full = mv.resolveScreenView("livestream", state, { ...opts, obsStore: store("full") });
    assert.equal(full.props.transparent, false);
    const lt = mv.resolveScreenView("livestream", state, { ...opts, obsStore: store("lowerthird") });
    assert.equal(lt.props.transparent, true);
    assert.equal(lt.detail, "Lower third");
    assert.equal(lt.props.background, null, "lower third drops backdrops (route parity)");
    assert.equal(lt.lowerThird, null, "lower third mode never draws the full-mode overlay");
  });

  check("layer overrides only pass through when the layers engine is on", () => {
    const overrides = new Map();
    const off = mv.resolveScreenView("main", state, { layersEnabled: false, layerOverrides: overrides });
    assert.equal(off.props.layerOverrides, undefined);
    const on = mv.resolveScreenView("main", state, { layersEnabled: true, layerOverrides: overrides });
    assert.equal(on.props.layerOverrides, overrides);
    assert.equal(on.props.layersEnabled, true);
  });

  check("null / junk state → safe empty views, never throws", () => {
    for (const junk of [null, undefined, 42, "x", {}, { live: 5 }]) {
      const st = mv.coercePreviewState(junk);
      for (const s of mv.MULTIVIEW_SCREENS) {
        const v = mv.resolveScreenView(s, st, opts);
        assert.ok(v.props.slide, `${s} has a slide`);
      }
    }
    assert.equal(mv.resolveScreenView("main", null, opts).empty, true);
  });

  check("every resolved view renders through the real OutputCompositor", () => {
    for (const s of mv.MULTIVIEW_SCREENS) {
      const v = mv.resolveScreenView(s, state, { ...opts, obsStore: store("lowerthird") });
      const html = renderToStaticMarkup(React.createElement(OutputCompositor, v.props));
      assert.ok(html.length > 0, `${s} rendered`);
      assert.ok(!html.includes("autoPlay"), `${s} must not autoplay media`);
    }
  });

  check("screen key guard", () => {
    assert.equal(mv.isMultiViewScreen("stage"), true);
    assert.equal(mv.isMultiViewScreen("projector"), false);
    assert.equal(mv.isMultiViewScreen(null), false);
  });

  console.log(`\nMultiView: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
