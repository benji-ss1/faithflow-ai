/**
 * LAYER ORDER V3 — rendered DOM half (plan half: test/layer-order-v3.test.ts).
 *   1. z-order in the markup: media → theme bg → slide → logo (renderToStaticMarkup).
 *   2. The media <video> element is the SAME DOM node across theme apply / clear /
 *      apply and slide changes (never remounted ⇒ never restarts).
 *   3. A theme video is the same node across slide changes.
 *   4. Flag off: no V3 wrappers at all.
 *   5. Blank start / cleared slide: theme bg hidden (still mounted), media shows.
 *   6. Announcement paints BELOW the logo (logo after it in the DOM).
 *   7. Dim stays a black overlay inside the theme layer; layerOpacity is CSS opacity.
 *   8. Covered media video is PAUSED (not reset, same node) and resumes on uncover.
 *   9. A legacy non-default slide bgColor is preserved under V3.
 *  10. Single flag store: setLayerOrderV3Flag → reader + hook agree, same tab.
 * Run: npx tsx test/layer-order-v3-dom.test.tsx
 */
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
for (const k of ["window", "document", "navigator", "HTMLElement", "Element", "CustomEvent", "Event", "KeyboardEvent", "MouseEvent", "Node", "localStorage"] as const) {
  const v = (dom.window as unknown as Record<string, unknown>)[k];
  if (v !== undefined) Object.defineProperty(globalThis, k, { value: v, configurable: true });
}
// Media element mock: jsdom has no playback. Track pause/play and keep a
// writable currentTime so "paused, not reset" is observable.
const MediaProto = (dom.window as unknown as { HTMLMediaElement: { prototype: object } }).HTMLMediaElement.prototype;
type MockVid = { _paused?: boolean; _t?: number; _pauses?: number; _plays?: number };
Object.defineProperty(MediaProto, "paused", { configurable: true, get(this: MockVid) { return this._paused ?? false; } });
Object.defineProperty(MediaProto, "currentTime", { configurable: true, get(this: MockVid) { return this._t ?? 0; }, set(this: MockVid, v: number) { this._t = v; } });
Object.defineProperty(MediaProto, "pause", { configurable: true, value(this: MockVid) { this._paused = true; this._pauses = (this._pauses ?? 0) + 1; } });
Object.defineProperty(MediaProto, "play", { configurable: true, value(this: MockVid) { this._paused = false; this._plays = (this._plays ?? 0) + 1; return Promise.resolve(); } });
Object.defineProperty(MediaProto, "load", { configurable: true, value() {} });
class RO { observe() {} unobserve() {} disconnect() {} }
Object.defineProperty(globalThis, "ResizeObserver", { value: RO, configurable: true });
Object.defineProperty(globalThis, "requestAnimationFrame", { value: (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number, configurable: true });
Object.defineProperty(globalThis, "cancelAnimationFrame", { value: (id: number) => clearTimeout(id), configurable: true });
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as unknown as { React: typeof React }).React = React;

import type { BackgroundSpec, SlidePayload, ThemeAppearance } from "../src/lib/broadcast";

let pass = 0, fail = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}

const VID: BackgroundSpec = { type: "video", videoUrl: "https://cdn.example.com/loop.mp4" };
const RED: ThemeAppearance = { bgType: "solid", bgColor: "#aa0000", logoUrl: "https://cdn.example.com/logo.png", logoPosition: "top-right" };
const BLUE: ThemeAppearance = { bgType: "solid", bgColor: "#0000aa" };
const THEME_VID: ThemeAppearance = { bgType: "video", bgVideoUrl: "https://cdn.example.com/theme.mp4" };
const lyric = (t: string): SlidePayload => ({ kind: "text", text: t });

async function main() {
  const { OutputCompositor } = await import("../src/components/live/OutputCompositor");
  const flag = await import("../src/lib/layer-order-v3");
  console.log("layer-order-v3 — DOM");

  const mount = () => {
    const host = document.createElement("div"); document.body.appendChild(host);
    return { host, root: createRoot(host) };
  };
  const hidden = (host: Element, id: string) => (host.querySelector(`[data-layer="${id}"]`) as HTMLElement | null)?.style.visibility === "hidden";

  await check("z-order in markup: media → theme bg → slide → logo", () => {
    const html = renderToStaticMarkup(<OutputCompositor mode="live" slide={lyric("Grace")} appearance={RED} background={VID} layerOrderV3 />);
    const order = [...html.matchAll(/data-layer="([\w-]+)"/g)].map((m) => m[1]);
    assert.deepEqual(order, ["background", "theme-bg", "slide", "theme-logo"]);
    const zs = [...html.matchAll(/data-z="(-?\d+)"/g)].map((m) => Number(m[1]));
    assert.deepEqual(zs, [...zs].sort((a, b) => a - b));
    assert.ok(html.includes("data-theme-bg-layer"), "theme bg layer painted");
  });

  await check("slide paints no theme bg and default black counts as unset", () => {
    const html = renderToStaticMarkup(<OutputCompositor mode="live" slide={{ kind: "text", text: "Grace", bgColor: "#000000" }} appearance={RED} background={VID} layerOrderV3 />);
    const slide = html.slice(html.indexOf('data-layer="slide"'), html.indexOf('data-layer="theme-logo"'));
    assert.ok(!slide.includes("aa0000"), "no theme colour in the slide layer");
    assert.ok(!/background:\s*(#000000|#000|#0b0b0b|black)\b/.test(slide), "no black in the slide layer");
    const themeLayer = html.slice(html.indexOf('data-layer="theme-bg"'), html.indexOf('data-layer="slide"'));
    assert.ok(themeLayer.includes("#aa0000"), "theme colour lives in the theme layer");
  });

  await check("flag off: no V3 wrappers", () => {
    const html = renderToStaticMarkup(<OutputCompositor mode="live" slide={lyric("Grace")} appearance={RED} background={VID} />);
    assert.ok(!html.includes("data-layer="), "no v3 wrapper");
    assert.ok(!html.includes("data-theme-bg-layer"));
  });

  await check("media <video> node is stable across theme apply / clear / apply + slide changes", async () => {
    const host = document.createElement("div"); document.body.appendChild(host);
    const root = createRoot(host);
    const r = (slide: SlidePayload, appearance: ThemeAppearance | null) =>
      act(async () => { root.render(<OutputCompositor mode="live" slide={slide} appearance={appearance} background={VID} layerOrderV3 />); });
    await r(lyric("1"), null);
    const media = () => host.querySelector('[data-layer="background"] video');
    const first = media();
    assert.ok(first, "media video rendered");
    await r(lyric("1"), RED); assert.equal(media(), first, "theme apply");
    await r(lyric("1"), null); assert.equal(media(), first, "theme clear");
    await r(lyric("2"), BLUE); assert.equal(media(), first, "slide change + another theme");
    await r({ kind: "empty" }, BLUE); assert.equal(media(), first, "clear slide");
    await act(async () => root.unmount());
  });

  await check("theme video node is stable across slide changes", async () => {
    const host = document.createElement("div"); document.body.appendChild(host);
    const root = createRoot(host);
    const r = (slide: SlidePayload) => act(async () => { root.render(<OutputCompositor mode="live" slide={slide} appearance={THEME_VID} background={VID} layerOrderV3 />); });
    await r(lyric("1"));
    const tv = () => host.querySelector("[data-theme-bg-video]");
    const first = tv(); assert.ok(first);
    await r(lyric("2")); await r({ kind: "empty" }); await r(lyric("3"));
    assert.equal(tv(), first);
    await act(async () => root.unmount());
  });

  await check("blank start: theme bg hidden (mounted), media visible; slide shows it; clear hides it again", async () => {
    const { host, root } = mount();
    const r = (slide: SlidePayload) => act(async () => { root.render(<OutputCompositor mode="live" slide={slide} appearance={THEME_VID} background={VID} layerOrderV3 />); });
    await r({ kind: "empty" });
    assert.equal(hidden(host, "theme-bg"), true, "blank start: theme hidden");
    assert.equal(hidden(host, "background"), false, "media visible");
    const tv = host.querySelector("[data-theme-bg-video]");
    assert.ok(tv, "theme video stays mounted while hidden");
    await r(lyric("1"));
    assert.equal(hidden(host, "theme-bg"), false, "slide live: theme shown");
    assert.equal(host.querySelector("[data-theme-bg-video]"), tv, "same theme video node (no restart)");
    await r({ kind: "empty" });
    assert.equal(hidden(host, "theme-bg"), true, "cleared slide: theme hidden");
    assert.equal(host.querySelector("[data-theme-bg-video]"), tv, "still the same node");
    await act(async () => root.unmount());
  });

  await check("announcement paints BELOW the logo (logo after it, window-relative announcement)", () => {
    const ann = { line1: "Welcome", position: "bottom", style: {} } as never;
    const html = renderToStaticMarkup(<OutputCompositor mode="live" slide={lyric("Grace")} appearance={RED} background={VID} layerOrderV3 announcement={ann} />);
    const iAnn = html.indexOf("Welcome");
    const iLogo = html.indexOf('data-layer="theme-logo"');
    const iSlide = html.indexOf('data-layer="slide"');
    assert.ok(iAnn > 0 && iLogo > 0, "both painted");
    assert.ok(iSlide < iAnn && iAnn < iLogo, "slide < announcement < logo in paint order");
    // Livestream (no canvas) keeps the same order.
    const ls = renderToStaticMarkup(<OutputCompositor mode="livestream" slide={lyric("Grace")} appearance={RED} background={VID} layerOrderV3 announcement={ann} />);
    assert.ok(ls.indexOf("Welcome") < ls.indexOf('data-layer="theme-logo"'));
  });

  await check("dim is a black overlay INSIDE the theme layer; layerOpacity is CSS see-through", () => {
    const dimmed = renderToStaticMarkup(<OutputCompositor mode="live" slide={lyric("x")} appearance={{ ...RED, dim: 0.4 }} background={VID} layerOrderV3 />);
    const tl = dimmed.slice(dimmed.indexOf("data-theme-bg-layer"), dimmed.indexOf('data-layer="slide"'));
    assert.ok(/rgba\(0,\s*0,\s*0,\s*0\.4\)/.test(tl), "dim overlay drawn in the theme layer");
    assert.ok(/opacity:\s*1\b/.test(tl), "dimmed theme layer stays opaque");
    const vid = renderToStaticMarkup(<OutputCompositor mode="live" slide={lyric("x")} appearance={{ ...THEME_VID, dim: 0.3 }} background={VID} layerOrderV3 />);
    assert.ok(vid.includes("data-theme-dim"), "video theme dim overlay");
    const half = renderToStaticMarkup(<OutputCompositor mode="live" slide={lyric("x")} appearance={{ ...RED, layerOpacity: 0.5 }} background={VID} layerOrderV3 />);
    const hl = half.slice(half.indexOf("data-theme-bg-layer"), half.indexOf('data-layer="slide"'));
    assert.ok(/opacity:\s*0\.5/.test(hl), "layerOpacity → CSS opacity 0.5");
  });

  await check("covered media video is PAUSED (same node, currentTime kept) and resumes on uncover", async () => {
    const { host, root } = mount();
    const r = (slide: SlidePayload, appearance: ThemeAppearance | null) =>
      act(async () => { root.render(<OutputCompositor mode="live" slide={slide} appearance={appearance} background={VID} layerOrderV3 />); });
    await r(lyric("1"), null);
    const v = host.querySelector('[data-layer="background"] video') as unknown as HTMLVideoElement & MockVid;
    assert.ok(v, "media video");
    assert.equal(v.paused, false, "playing while uncovered");
    v.currentTime = 12.5;
    await r(lyric("1"), RED); // opaque theme over media
    assert.equal(v.paused, true, "paused while covered");
    assert.equal(v.currentTime, 12.5, "currentTime NOT reset");
    assert.equal(host.querySelector('[data-layer="background"] video'), v, "same node");
    await r({ kind: "empty" }, RED); // theme hides with the slide → uncovered
    assert.equal(v.paused, false, "resumed on uncover");
    assert.equal(v.currentTime, 12.5, "resumed from where it was");
    await r(lyric("2"), { ...RED, layerOpacity: 0.5 }); // see-through never covers
    assert.equal(v.paused, false, "half see-through keeps media playing");
    // A video paused for another reason is never force-played.
    await r(lyric("2"), RED); v._paused = true; v._plays = 0;
    await r(lyric("3"), RED);
    await r({ kind: "empty" }, RED);
    assert.ok((v._plays ?? 0) <= 1, "only a cover-pause is resumed");
    await act(async () => root.unmount());
  });

  await check("theme video paused (not reset) while hidden, resumes when a slide goes live", async () => {
    const { host, root } = mount();
    const r = (slide: SlidePayload) => act(async () => { root.render(<OutputCompositor mode="live" slide={slide} appearance={THEME_VID} background={VID} layerOrderV3 />); });
    await r(lyric("1"));
    const tv = host.querySelector("[data-theme-bg-video]") as unknown as HTMLVideoElement & MockVid;
    tv.currentTime = 4.25;
    await r({ kind: "empty" });
    assert.equal(tv.paused, true); assert.equal(tv.currentTime, 4.25);
    await r(lyric("2"));
    assert.equal(tv.paused, false); assert.equal(tv.currentTime, 4.25);
    assert.equal(host.querySelector("[data-theme-bg-video]"), tv);
    await act(async () => root.unmount());
  });

  await check("legacy non-default slide bgColor is preserved under V3 (only default black is transparent)", () => {
    const html = renderToStaticMarkup(<OutputCompositor mode="live" slide={{ kind: "text", text: "Grace", bgColor: "#123456" }} appearance={RED} background={VID} layerOrderV3 />);
    const slide = html.slice(html.indexOf('data-layer="slide"'), html.indexOf('data-layer="theme-logo"'));
    assert.ok(slide.includes("#123456"), "legacy colour kept");
    const blank = renderToStaticMarkup(<OutputCompositor mode="live" slide={{ kind: "blank", bgColor: "#123456" } as SlidePayload} appearance={RED} background={VID} layerOrderV3 />);
    assert.ok(blank.slice(blank.indexOf('data-layer="slide"')).includes("#123456"), "blank keeps its colour");
  });

  await check("single flag store: setter → reader + hook agree in the same tab", async () => {
    const seen: boolean[] = [];
    function Probe() { const on = flag.useLayerOrderV3(); seen.push(on); return <i data-on={String(on)} />; }
    const { host, root } = mount();
    flag.setLayerOrderV3Flag(false);
    await act(async () => { root.render(<Probe />); });
    assert.equal(host.querySelector("i")!.getAttribute("data-on"), "false");
    assert.equal(flag.readLayerOrderV3Flag(), false);
    await act(async () => { flag.setLayerOrderV3Flag(true); });
    assert.equal(flag.readLayerOrderV3Flag(), true);
    assert.equal(host.querySelector("i")!.getAttribute("data-on"), "true", "hook follows the same-tab setter");
    await act(async () => { flag.setLayerOrderV3Flag(null); });
    assert.equal(host.querySelector("i")!.getAttribute("data-on"), String(flag.readLayerOrderV3Flag()));
    await act(async () => root.unmount());
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
void main();
