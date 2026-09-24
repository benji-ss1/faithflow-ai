/**
 * Theme gaps (PR A) — persistent theme-decor output layer + NO-REGRESSION proof.
 * Baseline test/fixtures/theme-gaps-baseline.json was generated from base commit
 * e779114 (main with PR #52) in a temp worktree via renderMatrix /
 * renderCompositorMatrix (test/theme-pr2-fixtures.ts). Every fixture appearance
 * is decor-less, so every render must stay byte-identical.
 * Run: npx tsx test/theme-decor-layer.test.ts
 */
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SlidePayload, ThemeAppearance } from "../src/lib/broadcast";
import { planOutput } from "../src/lib/output-plan";
import { renderMatrix, renderCompositorMatrix, SLIDES, APPEARANCES, themeWinsChangedKey } from "./theme-pr2-fixtures";
import baseline from "./fixtures/theme-gaps-baseline.json";
import { fontStack } from "../src/lib/fonts/registry";

// feat/fonts-p1 appends a generic fallback to every font-family at RENDER time
// (stored data is untouched). This baseline predates that, so map ONLY its
// font-family declarations through fontStack — every other byte must still match.
const withFontStacks = (html: string) => html.replace(/font-family:([^;"]+)/g, (_m, f: string) => `font-family:${fontStack(f) ?? f}`);

(globalThis as unknown as { React: typeof React }).React = React;
let pass = 0, fail = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message.slice(0, 700)}`); fail++; }
}
const VID = "https://cdn.example.com/decor.mp4";
const DECOR_APP: ThemeAppearance = { bgType: "solid", bgColor: "#101020", textColor: "#ffeecc",
  layout: { lyrics: { decor: [{ kind: "video", x: 0, y: 0, w: 600, h: 400, url: VID, anim: "fade" }] } } };
const LYRIC: SlidePayload = { kind: "text", text: "Amazing grace" };

async function main() {
  const { OutputCompositor } = await import("../src/components/live/OutputCompositor");
  const { SlideRenderer } = await import("../src/components/live/SlideRenderer");
  const { OutputSlide } = await import("../src/components/live/OutputSlide");
  const comp = (p: Record<string, unknown>) => renderToStaticMarkup(React.createElement(OutputCompositor, p as never));

  console.log("No-regression (base e779114):");
  await check("renderMatrix byte-identical to base for every decor-less appearance", async () => {
    const now = await renderMatrix();
    const base = (baseline as { renderer: Record<string, string> }).renderer;
    assert.equal(Object.keys(now).length, Object.keys(base).length);
    const diff = Object.keys(base).filter((k) => !themeWinsChangedKey(k) && now[k] !== withFontStacks(base[k]));
    assert.deepEqual(diff, []);
  });
  await check("renderCompositorMatrix byte-identical to base", async () => {
    const now = await renderCompositorMatrix();
    const base = (baseline as { compositor: Record<string, string> }).compositor;
    assert.equal(Object.keys(now).length, Object.keys(base).length);
    const diff = Object.keys(base).filter((k) => !themeWinsChangedKey(k) && now[k] !== withFontStacks(base[k]));
    assert.deepEqual(diff, []);
  });

  console.log("Plan:");
  await check("planOutput adds theme-decor (z5) ONLY when the theme has decor", () => {
    const withD = planOutput({ mode: "live", slide: LYRIC, appearance: DECOR_APP });
    const l = withD.layers.find((x) => x.id === "theme-decor");
    assert.ok(l && l.z === 5 && l.enabled);
    assert.deepEqual(withD.layers.map((x) => x.id), ["background", "theme-decor", "slide", "theme-logo"]);
  });
  await check("decor-less layer arrays deep-equal the legacy 3-layer shape (every fixture)", () => {
    for (const mode of ["live", "stage", "livestream", "ndi"] as const) {
      for (const slide of Object.values(SLIDES)) for (const appearance of Object.values(APPEARANCES)) {
        const p = planOutput({ mode, slide, appearance });
        assert.deepEqual(p.layers.map((x) => x.id), ["background", "slide", "theme-logo"]);
      }
    }
  });
  await check("theme-decor disabled on stage, transparent keying, over-video", () => {
    assert.equal(planOutput({ mode: "stage", slide: LYRIC, appearance: DECOR_APP }).layers.find((x) => x.id === "theme-decor")?.enabled, false);
    assert.equal(planOutput({ mode: "livestream", slide: LYRIC, appearance: DECOR_APP, transparent: true }).layers.find((x) => x.id === "theme-decor")?.enabled, false);
    assert.equal(planOutput({ mode: "live", slide: LYRIC, appearance: DECOR_APP, videoInput: { deviceId: "d", overlay: "full" } as never }).layers.find((x) => x.id === "theme-decor")?.enabled, false);
  });

  console.log("Compositor:");
  await check("decor renders OUTSIDE (before) the TransitionWrapper, anim stripped", () => {
    const html = comp({ mode: "live", slide: LYRIC, appearance: DECOR_APP, fontScale: 1 });
    const iLayer = html.indexOf("data-theme-decor-layer"), iVid = html.indexOf(VID), iText = html.indexOf("Amazing grace");
    assert.ok(iLayer >= 0 && iVid > iLayer && iText > iVid, html.slice(0, 900));
    assert.equal(html.split(VID).length - 1, 1, "decor video rendered exactly once (not also in-slide)");
    assert.ok(!html.includes("pf-obj-fade"), "entrance anim stripped");
  });
  await check("slide theme background transparent when hosted; text colour kept", () => {
    const hosted = renderToStaticMarkup(React.createElement(SlideRenderer, { slide: LYRIC, projectorFit: true, appearance: DECOR_APP, themeChromeHosted: true }));
    assert.ok(hosted.includes("background:transparent"), hosted.slice(0, 300));
    assert.ok(!hosted.includes("#101020"));
    assert.ok(!hosted.includes(VID));
    assert.ok(hosted.includes("#ffeecc"));
  });
  await check("hosted flag is a no-op for slides with their own background / no decor", () => {
    const own: SlidePayload = { kind: "text", text: "x", bgColor: "#ff0000" } as SlidePayload;
    const a = renderToStaticMarkup(React.createElement(SlideRenderer, { slide: own, projectorFit: true, appearance: DECOR_APP, themeChromeHosted: true }));
    const b = renderToStaticMarkup(React.createElement(SlideRenderer, { slide: own, projectorFit: true, appearance: DECOR_APP }));
    assert.equal(a, b);
    assert.ok(a.includes(VID), "own-bg slide keeps in-slide decor");
  });
  await check("blank slide: decor layer mounted but hidden", () => {
    const html = comp({ mode: "live", slide: { kind: "blank" }, appearance: DECOR_APP, fontScale: 1 });
    assert.ok(/data-theme-decor-layer[^>]*visibility:hidden/.test(html), html.slice(0, 600));
  });
  await check("previewFrozen pauses the decor video (no autoplay)", () => {
    const html = comp({ mode: "live", slide: LYRIC, appearance: DECOR_APP, fontScale: 1, previewFrozen: true });
    assert.ok(!/<video[^>]*autoPlay/i.test(html) && !/<video[^>]*autoplay/.test(html), html);
  });
  await check("over theme video: decor between video and overlay, once", () => {
    const vApp: ThemeAppearance = { ...DECOR_APP, bgType: "video", bgVideoUrl: "https://cdn.example.com/bg.mp4" };
    const html = renderToStaticMarkup(React.createElement(OutputSlide, { slide: LYRIC, appearance: vApp }));
    const iBg = html.indexOf("bg.mp4"), iDecor = html.indexOf(VID), iText = html.indexOf("Amazing grace");
    assert.ok(iBg >= 0 && iDecor > iBg && iText > iDecor, html.slice(0, 900));
    assert.equal(html.split(VID).length - 1, 1);
  });
  await check("full-screen camera + decor: scrim sits BEFORE the decor, not on the words container", () => {
    const html = renderToStaticMarkup(React.createElement(OutputSlide, { slide: LYRIC, appearance: DECOR_APP, videoInput: { deviceId: "d", overlay: "full" } as never }));
    const iScrim = html.indexOf("data-camera-scrim"), iDecor = html.indexOf("data-theme-decor-layer"), iText = html.indexOf("Amazing grace");
    assert.ok(iScrim >= 0 && iDecor > iScrim && iText > iDecor, html.slice(0, 900));
    assert.equal(html.split("bg-black/45").length - 1, 1, "scrim rendered once");
  });
  await check("full-screen camera WITHOUT decor: scrim stays on the container (DOM unchanged)", () => {
    const { layout: _l, ...noDecor } = DECOR_APP; void _l;
    const html = renderToStaticMarkup(React.createElement(OutputSlide, { slide: LYRIC, appearance: noDecor, videoInput: { deviceId: "d", overlay: "full" } as never }));
    assert.ok(!html.includes("data-camera-scrim"));
    assert.ok(html.includes("absolute inset-0 flex items-center justify-center bg-black/45"));
  });
  await check("over camera lower-third: no decor (band)", () => {
    const html = renderToStaticMarkup(React.createElement(OutputSlide, { slide: LYRIC, appearance: DECOR_APP, videoInput: { deviceId: "d", overlay: "lowerThird" } as never }));
    assert.ok(!html.includes(VID));
  });
  console.log(`\ntheme-decor-layer: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main();
