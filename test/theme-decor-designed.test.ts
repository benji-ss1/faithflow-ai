/**
 * Theme gaps (PR A) — theme decor on DESIGNED multi-object slides + coversCanvas.
 * Run: npx tsx test/theme-decor-designed.test.ts
 */
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SlidePayload, ThemeAppearance } from "../src/lib/broadcast";
import { coversCanvas } from "../src/lib/slide-objects";
import { themeDecorPlan } from "../src/lib/theme-decor-plan";

(globalThis as unknown as { React: typeof React }).React = React;
let pass = 0, fail = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message.slice(0, 500)}`); fail++; }
}
const DECOR_URL = "https://cdn.example.com/decor.png";
const APP: ThemeAppearance = { bgType: "solid", bgColor: "#101020", layout: { lyrics: { decor: [{ kind: "image", x: 0, y: 0, w: 400, h: 300, url: DECOR_URL }] } } };
const DESIGNED: SlidePayload = { kind: "text", text: "Hello", objects: [
  { kind: "shape", x: 0, y: 0, w: 1920, h: 200, shape: "rect", fill: "#112233" },
  { kind: "text", x: 100, y: 400, w: 1700, h: 300, text: "Hello", fontSize: 90 },
] };

async function main() {
  const { SlideRenderer } = await import("../src/components/live/SlideRenderer");
  const r = (slide: SlidePayload, props: Record<string, unknown> = {}) => renderToStaticMarkup(React.createElement(SlideRenderer, { slide, projectorFit: true, appearance: APP, ...props }));

  await check("decor renders on a designed slide, BEFORE the slide's own objects", () => {
    const html = r(DESIGNED);
    const iDecor = html.indexOf(DECOR_URL), iShape = html.indexOf("#112233");
    assert.ok(iDecor > 0 && iShape > 0 && iDecor < iShape, html.slice(0, 600));
    assert.ok(html.includes("pointer-events-none"), "decor is pointer-events-none");
  });
  await check("gated off: transparent, stage ignore, camera band, off-centre over video", () => {
    assert.ok(!r(DESIGNED, { transparentBg: true }).includes(DECOR_URL));
    assert.ok(!r(DESIGNED, { ignoreThemeLayout: true }).includes(DECOR_URL));
    assert.ok(!r(DESIGNED, { overVideo: true, fitBandFraction: 0.38 }).includes(DECOR_URL));
    assert.ok(!r(DESIGNED, { overVideo: true, verticalAlign: "top" }).includes(DECOR_URL));
  });
  await check("suppressed when the first object is a covering media object", () => {
    const media: SlidePayload = { kind: "text", text: "", objects: [
      { kind: "image", x: 0, y: 0, w: 1920, h: 1080, url: "https://cdn.example.com/flyer.jpg" },
      { kind: "text", x: 100, y: 400, w: 1700, h: 300, text: "Hi" },
    ] };
    assert.ok(!r(media).includes(DECOR_URL));
    assert.equal(themeDecorPlan(media, APP, {}), null);
  });
  await check("no-decor theme: designed render byte-identical to theme without layout", () => {
    const { layout: _l, ...noLayout } = APP; void _l;
    assert.equal(r(DESIGNED, { appearance: { ...noLayout, layout: {} } }), r(DESIGNED, { appearance: noLayout }));
  });
  await check("coversCanvas: pure cases", () => {
    assert.equal(coversCanvas([{ kind: "image", x: 0, y: 0, w: 1920, h: 1080 }]), true);
    assert.equal(coversCanvas([{ kind: "video", x: -10, y: -10, w: 1940, h: 1100 }]), true);
    assert.equal(coversCanvas([{ kind: "image", x: 0, y: 0, w: 1000, h: 1080 }]), false);
    assert.equal(coversCanvas([{ kind: "shape", x: 0, y: 0, w: 1920, h: 1080 }, { kind: "image", x: 0, y: 0, w: 1920, h: 1080 }]), false);
    assert.equal(coversCanvas([{ kind: "image", x: 0, y: 0, w: 1920, h: 1080, hidden: true }, { kind: "text", x: 0, y: 0, w: 1, h: 1 }]), false);
    assert.equal(coversCanvas([]), false);
    assert.equal(coversCanvas(undefined), false);
  });
  await check("plan: designed slide with own bg keeps decor in-slide (plan null)", () => {
    assert.equal(themeDecorPlan({ ...DESIGNED, bgColor: "#ff0000" } as SlidePayload, APP, {}), null);
    assert.ok(r({ ...DESIGNED, bgColor: "#ff0000" } as SlidePayload).includes(DECOR_URL));
  });
  console.log(`\ntheme-decor-designed: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main();
