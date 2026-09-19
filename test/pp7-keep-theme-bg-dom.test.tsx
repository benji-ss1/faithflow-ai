/**
 * PP7 "Clear Slide keeps the theme's media" — the RENDERED half (the pure half is
 * `test/pp7-keep-theme-bg.test.ts`).
 *
 * `test/fixtures/output-dom-empty-main.golden.json` is the markup `main` produced
 * for an EMPTY slide (what a projector shows after a Slide clear) across
 * /live, /stage, /livestream, /ndi and the OBS/NDI alpha key, BEFORE this feature
 * existed (regenerate with `test/pp7-keep-theme-bg-dom-golden.tsx`).
 *
 * Contracts:
 *   1. INERT without the flag: a plain empty slide renders byte-identical to main.
 *   2. KILL SWITCH: with the switch off, an empty-with-theme slide renders
 *      byte-identical to main (localStorage "0" and the parent PP7 flag both).
 *   3. With the switch on, the theme's background (image / video / animated /
 *      decor) stays under an empty slide, with NO words, on /live, /stage,
 *      /livestream and /ndi.
 *   4. ALPHA KEY stays transparent exactly as before (livestream/ndi transparent).
 *   5. A background template / camera behind the slide is untouched.
 *   6. NO FADE-PULSE: plain empty -> empty-with-theme does not remount the
 *      transition frame.
 *
 * Run: npx tsx test/pp7-keep-theme-bg-dom.test.tsx
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { emptyMatrix, emptyKey, imageTheme, videoTheme, auroraTheme, decorTheme, solidTheme, type EmptyFixture } from "./pp7-keep-theme-bg-dom-matrix";
import { PP7_KEEP_THEME_BG_STORAGE_KEY } from "../src/lib/pp7-keep-theme-bg";
import { PP7_LAYERS_STORAGE_KEY } from "../src/lib/pp7-layers-flag";
import { fontStack } from "../src/lib/fonts/registry";
import type { SlidePayload } from "../src/lib/broadcast";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
for (const k of ["window", "document", "navigator", "HTMLElement", "Element", "CustomEvent", "Event", "KeyboardEvent", "MouseEvent", "Node", "localStorage"] as const) {
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
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}

const withFontStacks = (html: string) => html.replace(/font-family:\s*([^;"]+)/g, (_m, f: string) => `font-family: ${fontStack(f.trim()) ?? f.trim()}`);
const golden: Record<string, string> = JSON.parse(readFileSync(new URL("./fixtures/output-dom-empty-main.golden.json", import.meta.url), "utf8"));
const goldenOf = (f: EmptyFixture) => withFontStacks(golden[emptyKey(f)]);

const KEEP: SlidePayload = { kind: "empty", keepThemeBg: true };

async function renderAll(slideFor: (f: EmptyFixture) => SlidePayload): Promise<Record<string, string>> {
  const { OutputCompositor } = await import("../src/components/live/OutputCompositor");
  const out: Record<string, string> = {};
  for (const f of emptyMatrix()) {
    const props: Record<string, unknown> = { ...f, slide: slideFor(f) };
    delete props.name;
    const host = dom.window.document.createElement("div");
    host.className = "relative w-full h-full";
    dom.window.document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(React.createElement(OutputCompositor, props as never)); });
    out[emptyKey(f)] = host.innerHTML;
    await act(async () => { root.unmount(); });
    host.remove();
  }
  return out;
}

const ls = () => dom.window.localStorage;

async function main() {
  const fixtures = emptyMatrix();
  assert.equal(Object.keys(golden).length, fixtures.length, "golden and matrix must line up");

  ls().clear(); // switch at its DEFAULT (on)
  const plainOn = await renderAll(() => ({ kind: "empty" }));
  const keepOn = await renderAll(() => KEEP);
  ls().setItem(PP7_KEEP_THEME_BG_STORAGE_KEY, "0");
  const keepOffLocal = await renderAll(() => KEEP);
  ls().clear();
  ls().setItem(PP7_LAYERS_STORAGE_KEY, "0");
  const keepOffParent = await renderAll(() => KEEP);
  const plainOffParent = await renderAll(() => ({ kind: "empty" }));
  ls().clear();

  check("INERT: a plain empty slide is byte-identical to main, all fixtures (switch on)", () => {
    const diffs = fixtures.filter((f) => withFontStacks(plainOn[emptyKey(f)]) !== goldenOf(f)).map(emptyKey);
    assert.deepEqual(diffs, [], `changed with no flag set:\n   ${diffs.join("\n   ")}`);
  });

  check("KILL SWITCH (localStorage 0): empty-with-theme renders byte-identical to main, all fixtures", () => {
    const diffs = fixtures.filter((f) => withFontStacks(keepOffLocal[emptyKey(f)]) !== goldenOf(f)).map(emptyKey);
    assert.deepEqual(diffs, [], `changed with the switch OFF:\n   ${diffs.join("\n   ")}`);
  });

  check("KILL SWITCH (parent PP7 layers off, which also reverts the draw order): empty-with-theme == a plain empty slide", () => {
    // Compared to a plain empty render under the SAME parent flag (the golden was
    // captured with the draw order on, which the parent flag also switches off).
    const diffs = fixtures.filter((f) => keepOffParent[emptyKey(f)] !== plainOffParent[emptyKey(f)]).map(emptyKey);
    assert.deepEqual(diffs, [], diffs.join("\n"));
  });

  const byName = (name: string, modes: string[]) => fixtures.filter((f) => f.name === name && modes.includes(f.mode));

  check("/live /stage /livestream: an image theme's background STAYS, with no words", () => {
    for (const f of byName("image theme", ["live", "stage", "livestream"])) {
      const html = keepOn[emptyKey(f)];
      assert.ok(html.includes("https://x/worship-bg.jpg"), `${emptyKey(f)}: the theme background must still paint`);
      assert.ok(html.includes("data-theme-bg-kept"), `${emptyKey(f)}: kept marker`);
      assert.ok(!html.includes("bg-black"), `${emptyKey(f)}: must not be the plain black empty slide`);
      // …and it really differs from what the plain clear shows today.
      assert.notEqual(html, goldenOf(f), `${emptyKey(f)}: same as today — the feature did nothing`);
    }
  });

  check("/ndi (opaque): the theme background stays too", () => {
    const f = byName("image theme", ["ndi"])[0];
    assert.ok(keepOn[emptyKey(f)].includes("https://x/worship-bg.jpg"));
  });

  check("ALPHA KEY stays transparent EXACTLY as today (livestream + ndi transparent)", () => {
    for (const f of fixtures.filter((x) => x.transparent)) {
      assert.equal(withFontStacks(keepOn[emptyKey(f)]), goldenOf(f), `${emptyKey(f)}: the alpha output must not gain a background`);
      assert.ok(!keepOn[emptyKey(f)].includes("worship-bg.jpg"), `${emptyKey(f)}: theme image leaked into the alpha key`);
    }
  });

  check("a global Background Template stays as-is (already survives a Slide clear; theme bg is hidden behind it)", () => {
    for (const f of fixtures.filter((x) => x.name === "image theme + global media" || x.name === "image theme + global media transparent")) {
      assert.equal(withFontStacks(keepOn[emptyKey(f)]), goldenOf(f), emptyKey(f));
      assert.ok(!keepOn[emptyKey(f)].includes("worship-bg.jpg"), `${emptyKey(f)}: theme image must not paint over the template`);
    }
  });

  check("a live camera behind the slide is untouched (stage never has a camera, so it shows the theme as usual)", () => {
    for (const f of fixtures.filter((x) => x.name === "image theme + camera" && x.mode !== "stage")) {
      assert.equal(withFontStacks(keepOn[emptyKey(f)]), goldenOf(f), emptyKey(f));
    }
  });

  check("theme VIDEO background keeps playing under the empty slide (persistent video, no black)", () => {
    for (const f of byName("video theme", ["live", "livestream", "ndi"])) {
      if (f.transparent) continue;
      assert.ok(keepOn[emptyKey(f)].includes("https://x/theme-loop.mp4"), `${emptyKey(f)}: theme video must stay`);
    }
  });

  check("theme DECOR stays on /live and /livestream (above the media, no words); stage stays full-screen", () => {
    for (const f of byName("decor theme", ["live", "livestream"])) {
      assert.ok(keepOn[emptyKey(f)].includes("https://x/decor.png"), `${emptyKey(f)}: decor must paint`);
      assert.ok(!goldenOf(f).includes("https://x/decor.png"), `${emptyKey(f)}: today's clear paints no decor (proves the change)`);
    }
    const stage = byName("decor theme", ["stage"])[0];
    assert.ok(!keepOn[emptyKey(stage)].includes("https://x/decor.png"), "stage ignores theme layout/decor, as with text slides");
    assert.ok(keepOn[emptyKey(stage)].includes("https://x/worship-bg.jpg"), "stage still shows the theme background");
  });

  check("an animated theme background keeps animating under the empty slide", () => {
    const f = byName("animated theme", ["live"])[0];
    assert.notEqual(keepOn[emptyKey(f)], goldenOf(f));
    assert.ok(keepOn[emptyKey(f)].includes("data-theme-bg-kept") || keepOn[emptyKey(f)].includes("pf-"), "animated bg present");
  });

  check("a solid-colour / no theme still goes plain black on Slide clear when kept is (wrongly) set", () => {
    // The operator never sets the flag for these (decideSlideClear => plain), but
    // if it ever arrived the surface must not paint anything invented: no theme
    // media => the theme background style is the fallback black.
    for (const f of byName("no theme", ["live", "stage", "livestream", "ndi"])) {
      assert.ok(!keepOn[emptyKey(f)].includes("http"), `${emptyKey(f)}: nothing to show`);
    }
  });

  // ── no fade-pulse ──────────────────────────────────────────────────────────
  {
    const { OutputCompositor } = await import("../src/components/live/OutputCompositor");
    const f = fixtures.find((x) => x.mode === "live" && x.name === "image theme + fade")!;
    const host = dom.window.document.createElement("div");
    dom.window.document.body.appendChild(host);
    const root = createRoot(host);
    const props = (slide: SlidePayload) => ({ ...f, slide, name: undefined }) as never;
    await act(async () => { root.render(React.createElement(OutputCompositor, props({ kind: "empty" }))); });
    const frameOf = () => (host.querySelector("[data-theme-bg-kept]") ?? host.querySelector(".bg-black"))!.parentElement!;
    const before = frameOf();
    const animBefore = (before as HTMLElement).style.animation;
    await act(async () => { root.render(React.createElement(OutputCompositor, props(KEEP))); });
    const after = frameOf();
    check("NO FADE-PULSE: empty -> empty-with-theme keeps the SAME transition frame (no remount, no replay)", () => {
      assert.equal(after, before, "the transition frame was remounted => the enter animation would replay");
      assert.equal((after as HTMLElement).style.animation, animBefore);
      assert.ok(host.querySelector("[data-theme-bg-kept]"), "and the theme background did appear");
    });
    await act(async () => { root.render(React.createElement(OutputCompositor, props({ kind: "empty" }))); });
    check("NO FADE-PULSE: releasing (kept -> plain empty) does not remount either", () => {
      assert.equal(frameOf(), before);
      assert.ok(!host.querySelector("[data-theme-bg-kept]"), "Clear Media releases the theme background");
    });
    await act(async () => { root.unmount(); });
    host.remove();
  }

  // ── the theme comes back: text -> clear(kept) -> next slide ────────────────
  {
    const { OutputCompositor } = await import("../src/components/live/OutputCompositor");
    const f = fixtures.find((x) => x.mode === "live" && x.name === "image theme")!;
    const host = dom.window.document.createElement("div");
    dom.window.document.body.appendChild(host);
    const root = createRoot(host);
    const render = (slide: SlidePayload) => act(async () => { root.render(React.createElement(OutputCompositor, { ...f, slide, name: undefined } as never)); });
    await render({ kind: "text", text: "Amazing grace" });
    check("text slide shows the theme background AND the words", () => {
      assert.ok(host.innerHTML.includes("Amazing grace") && host.innerHTML.includes("https://x/worship-bg.jpg"));
    });
    await render(KEEP);
    check("Slide clear: words gone, theme background remains", () => {
      assert.ok(!host.innerHTML.includes("Amazing grace"));
      assert.ok(host.innerHTML.includes("https://x/worship-bg.jpg"));
    });
    await render({ kind: "text", text: "How sweet the sound" });
    check("the next slide replaces the kept background with the normal themed slide", () => {
      assert.ok(host.innerHTML.includes("How sweet the sound") && !host.innerHTML.includes("data-theme-bg-kept"));
    });
    await act(async () => { root.unmount(); });
    host.remove();
  }
  void videoTheme; void auroraTheme; void decorTheme; void imageTheme; void solidTheme;

  console.log(`\nPP7 keep theme background (DOM): ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
