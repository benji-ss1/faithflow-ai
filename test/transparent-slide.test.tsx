/**
 * TRANSPARENT SLIDE LAYER (owner directive 2026-09-20, the ProPresenter model).
 *
 *   "The slide itself should basically contain the lyrics, scripture or text, while the
 *    background is a separate layer underneath… Only when a background is added through
 *    Themes for the desired colour should there actually be a coloured background…
 *    If the background is cleared, the slide should return to being transparent and the
 *    image underneath should immediately become visible again."
 *
 * Renders the REAL SlideRenderer in jsdom and asserts the slide surface, because that is
 * the thing that either reveals or covers the layer beneath.
 * Run: npx tsx test/transparent-slide.test.tsx
 */
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { TRANSPARENT_SLIDE_STORAGE_KEY } from "../src/lib/transparent-slide";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
for (const k of ["window", "document", "navigator", "HTMLElement", "Element", "CustomEvent", "Event", "Node", "localStorage", "getComputedStyle"] as const) {
  const v = (dom.window as unknown as Record<string, unknown>)[k];
  if (v !== undefined) Object.defineProperty(globalThis, k, { value: v, configurable: true });
}
class RO { observe() {} unobserve() {} disconnect() {} }
Object.defineProperty(globalThis, "ResizeObserver", { value: RO, configurable: true });
Object.defineProperty(globalThis, "requestAnimationFrame", { value: (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number, configurable: true });
Object.defineProperty(globalThis, "cancelAnimationFrame", { value: (id: number) => clearTimeout(id), configurable: true });
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as unknown as { React: typeof React }).React = React;

let pass = 0, fail = 0;
const check = (n: string, fn: () => void | Promise<void>) => Promise.resolve().then(fn)
  .then(() => { console.log(`  PASS  ${n}`); pass++; })
  .catch((e) => { console.error(`  FAIL  ${n}\n        ${(e as Error).message}`); fail++; });

const SLIDE = { kind: "text" as const, text: "Amazing grace how sweet the sound" };

async function surfaceBg(appearance: unknown, opts: { flag: boolean; slide?: Record<string, unknown> }) {
  const { SlideRenderer } = await import("../src/components/live/SlideRenderer");
  dom.window.localStorage.setItem(TRANSPARENT_SLIDE_STORAGE_KEY, opts.flag ? "1" : "0");
  const host = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(SlideRenderer, { slide: { ...SLIDE, ...(opts.slide ?? {}) }, appearance } as never));
  });
  // The slide surface is the outermost element the renderer produces.
  const el = host.firstElementChild as HTMLElement | null;
  const bg = el ? (el.style.background || el.style.backgroundColor || "") : "";
  await act(async () => { root.unmount(); });
  host.remove();
  return bg;
}

(async () => {
  console.log("a slide nobody gave a background to is a TRANSPARENT text layer:");
  await check("no theme at all -> transparent (the layer underneath shows through)", async () => {
    assert.match(await surfaceBg(null, { flag: true }), /transparent/);
  });
  await check("a theme with only text styling -> still transparent", async () => {
    assert.match(await surfaceBg({ textColor: "#ffffff", fontFamily: "Sora" }, { flag: true }), /transparent/);
  });

  console.log("a background that WAS chosen still paints, and so covers what is under it:");
  await check("theme background colour (black) -> opaque black, image underneath is hidden", async () => {
    const bg = await surfaceBg({ bgType: "solid", bgColor: "#000000" }, { flag: true });
    assert.match(bg, /rgb\(0, 0, 0\)|#000000/);
    assert.doesNotMatch(bg, /transparent/);
  });
  await check("theme background image -> paints the image", async () => {
    const bg = await surfaceBg({ bgType: "image", bgImageUrl: "https://example.com/bg.png" }, { flag: true });
    assert.match(bg, /url\(/);
  });
  await check("theme gradient -> paints the gradient", async () => {
    const bg = await surfaceBg({ bgType: "gradient", bgColor: "#112233", bgColor2: "#445566" }, { flag: true });
    assert.match(bg, /gradient/);
  });
  await check("a per-slide colour still wins over the theme", async () => {
    const bg = await surfaceBg({ bgType: "solid", bgColor: "#000000" }, { flag: true, slide: { bgColor: "#ff0000" } });
    assert.match(bg, /rgb\(255, 0, 0\)|#ff0000/);
  });

  console.log("clearing the background returns the slide to transparent:");
  await check("theme colour set -> opaque; same theme with the colour cleared -> transparent", async () => {
    const withBg = await surfaceBg({ bgType: "solid", bgColor: "#000000", textColor: "#fff" }, { flag: true });
    const cleared = await surfaceBg({ textColor: "#fff" }, { flag: true });
    assert.doesNotMatch(withBg, /transparent/);
    assert.match(cleared, /transparent/);
  });

  console.log("kill switch: OFF is the old opaque behaviour, byte for byte:");
  await check("flag OFF -> the old near-black fill, not transparent", async () => {
    const bg = await surfaceBg(null, { flag: false });
    assert.doesNotMatch(bg, /transparent/);
    assert.match(bg, /rgb\(11, 11, 11\)|#0b0b0b/);
  });
  await check("flag OFF with a theme colour is unchanged too", async () => {
    assert.match(await surfaceBg({ bgType: "solid", bgColor: "#123456" }, { flag: false }), /rgb\(18, 52, 86\)|#123456/);
  });

  console.log("every output surface still paints its own black, so nothing shows through in real life:");
  await check("live / stage / livestream / ndi carry the screen colour", async () => {
    const { readFileSync } = await import("node:fs");
    const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
    assert.match(read("src/app/live/page.tsx"), /fixed inset-0 bg-black/);
    assert.match(read("src/app/stage/page.tsx"), /background: "#000"/);
    assert.match(read("src/app/livestream/page.tsx"), /background: transparent \? "transparent" : "#000"/);
    assert.match(read("src/app/ndi/page.tsx"), /transparent \? "transparent" : "#000"/);
  });
  await check("operator cards carry it too (below the background template, like the projector)", async () => {
    const { readFileSync } = await import("node:fs");
    const card = readFileSync(new URL("../src/components/operator/pro/center/ThemedSlideCard.tsx", import.meta.url), "utf8");
    assert.match(card, /transparentSlide && <div aria-hidden className="absolute inset-0" style=\{\{ background: "#000" \}\} \/>/);
    assert.ok(card.indexOf("transparentSlide &&") < card.indexOf("{showBg && <CardBackground"), "screen colour sits BELOW the template");
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
