/**
 * CHOSEN BACKGROUNDS ("bgExplicit", 2026-09-21).
 *
 * The bug: `song_slides` stores bg_color NOT NULL DEFAULT '#000000', so a slide's
 * background colour could not distinguish "the operator picked black" from
 * "nobody ever set this". The renderer had to guess (isDefaultSlideBg treats a
 * default black as unset, so it doesn't cover the theme/Background Template),
 * which meant an operator who genuinely picked black got NOTHING — and theme-bake
 * had to nudge a black theme to the near-black sentinel "#010101" to sneak past
 * the guess.
 *
 * The fix: `bgExplicit: true` records that a background was CHOSEN. Chosen colours
 * paint, even pure black. Rows without the flag keep the old heuristic exactly, so
 * every pre-existing slide renders byte-identically.
 *
 * Renders the REAL SlideRenderer in jsdom, because the slide surface is the thing
 * that either reveals or covers the layer beneath.
 * Run: npx tsx test/slide-bg-explicit.test.tsx
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

// A theme that styles text but chooses NO background — so anything the slide
// paints is the slide's own doing.
const TEXT_ONLY_THEME = { textColor: "#ffffff", fontFamily: "Sora" };

async function surfaceBg(slide: Record<string, unknown>, appearance: unknown = TEXT_ONLY_THEME) {
  const { SlideRenderer } = await import("../src/components/live/SlideRenderer");
  dom.window.localStorage.setItem(TRANSPARENT_SLIDE_STORAGE_KEY, "1");
  const host = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(SlideRenderer, { slide: { kind: "text", text: "Amazing grace", ...slide }, appearance } as never));
  });
  const el = host.firstElementChild as HTMLElement | null;
  const bg = el ? (el.style.background || el.style.backgroundColor || "") : "";
  await act(async () => { root.unmount(); });
  host.remove();
  return bg;
}

const isBlack = (bg: string) => /rgb\(0,\s*0,\s*0\)|#000000/.test(bg);

(async () => {
  console.log("the bug this fixes — an operator can finally choose black:");
  await check("black WITHOUT the flag is read as the unset DB default → transparent (old behaviour, unchanged)", async () => {
    const bg = await surfaceBg({ bgColor: "#000000" });
    assert.match(bg, /transparent/, `expected transparent, got ${bg}`);
  });
  await check("black WITH the flag is a real choice → paints black", async () => {
    const bg = await surfaceBg({ bgColor: "#000000", bgExplicit: true });
    assert.ok(isBlack(bg), `expected black, got ${bg}`);
    assert.doesNotMatch(bg, /transparent/);
  });

  console.log("back-compat — every pre-existing row renders exactly as it did:");
  await check("a legacy #010101 sentinel row still paints (old bakes keep working)", async () => {
    const bg = await surfaceBg({ bgColor: "#010101" });
    assert.doesNotMatch(bg, /transparent/, `expected the near-black to paint, got ${bg}`);
  });
  await check("a customised non-black colour paints with or without the flag", async () => {
    const without = await surfaceBg({ bgColor: "#ff0000" });
    const with_ = await surfaceBg({ bgColor: "#ff0000", bgExplicit: true });
    assert.match(without, /rgb\(255,\s*0,\s*0\)|#ff0000/);
    assert.match(with_, /rgb\(255,\s*0,\s*0\)|#ff0000/);
  });
  await check("no background at all is still transparent, flag or not", async () => {
    assert.match(await surfaceBg({}), /transparent/);
  });

  console.log("the flag is only ever a positive signal — it can never invent a background:");
  await check("bgExplicit with NO colour does not paint anything", async () => {
    assert.match(await surfaceBg({ bgExplicit: true }), /transparent/);
  });

  console.log("the wire carries it, and refuses anything but a literal `true`:");
  await check("validator accepts true, rejects truthy junk", async () => {
    const { isValidSlide } = await import("../src/lib/broadcast") as unknown as { isValidSlide?: (s: unknown) => boolean };
    const { sanitizeSlide } = await import("../src/lib/broadcast") as unknown as { sanitizeSlide?: (s: unknown) => unknown };
    const { projectableTextSlide } = await import("../src/lib/broadcast");
    // projectableTextSlide is the single chokepoint every surface builds through.
    const good = projectableTextSlide("hi", "#000000", undefined, undefined, true) as Record<string, unknown>;
    assert.equal(good.bgExplicit, true);
    const junk = projectableTextSlide("hi", "#000000", undefined, undefined, "yes") as Record<string, unknown>;
    assert.equal(junk.bgExplicit, undefined, "a non-true value must not become a chosen background");
    const off = projectableTextSlide("hi", "#000000", undefined, undefined, false) as Record<string, unknown>;
    assert.equal(off.bgExplicit, undefined);
    void isValidSlide; void sanitizeSlide;
  });

  console.log("a chosen black is CONTENT, so two different slides keep different identities:");
  await check("slideDesignSig separates chosen black from unset black", async () => {
    const { slideDesignSig } = await import("../src/lib/broadcast");
    const unset = slideDesignSig({ kind: "text", text: "x", bgColor: "#000000" } as never);
    const chosen = slideDesignSig({ kind: "text", text: "x", bgColor: "#000000", bgExplicit: true } as never);
    assert.notEqual(unset, chosen, "they render differently, so they must not share a transition identity");
  });

  console.log("theme bake no longer mints the #010101 sentinel:");
  await check("baking a black theme yields real black + chosen", async () => {
    const { bakeThemeIntoObjectsJson } = await import("../src/lib/theme-bake");
    const out = bakeThemeIntoObjectsJson({ bgType: "solid", bgColor: "#000000" } as never, { objects: [] });
    assert.equal(out.bgColor, "#000000");
    assert.equal(out.bgExplicit, true);
  });

  // Six review agents found five places that copied a background but dropped the
  // marker that said it was chosen — which silently reproduces the exact bug this
  // change fixes. Lock each one.
  console.log("the marker travels with the background everywhere it is copied:");
  await check("scripture Full<->Third relayout keeps it", async () => {
    const { sourceForRelayout } = await import("../src/components/operator/scripture/scriptureStyle");
    const out = sourceForRelayout({ kind: "text", text: "v", scriptureLayout: "lowerThird", bgColor: "#000000", bgExplicit: true } as never) as Record<string, unknown>;
    assert.equal(out.bgExplicit, true, "toggling layout must not drop a designed slide's chosen background");
  });
  await check("theme undo/re-apply resets it in lockstep with the colour it describes", async () => {
    const { THEME_OWNED_SLIDE_FIELDS } = await import("../src/lib/theme-rebake");
    assert.ok((THEME_OWNED_SLIDE_FIELDS as readonly string[]).includes("bgExplicit"),
      "a theme bake sets bgExplicit, so undo must restore it or a stale true survives");
  });
  await check("'Apply background to all slides' copies it to every slide", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/components/operator/editor/useSlideEditor.ts", import.meta.url), "utf8");
    assert.match(src, /bgColor: cur\.bgColor, bgImageUrl: cur\.bgImageUrl, bgExplicit: cur\.bgExplicit/,
      "applyToAll must carry bgExplicit or one slide is black and the rest are not");
  });
  await check("custom slide templates save AND apply it", async () => {
    const { readFileSync } = await import("node:fs");
    const type = readFileSync(new URL("../src/lib/custom-templates.ts", import.meta.url), "utf8");
    assert.match(type, /bgExplicit\?: boolean/, "the stored template must have somewhere to keep it");
    const modal = readFileSync(new URL("../src/components/operator/pro/DesktopSlideEditorModal.tsx", import.meta.url), "utf8");
    assert.match(modal, /bgExplicit: ct\.bgExplicit/, "applying a template must restore it");
    assert.match(modal, /bgExplicit: slide\.bgExplicit, objects: slide\.objects/, "saving a template must record it");
  });

  console.log("the operator can tell the two apart, and get back to see-through:");
  await check("the editor offers a way to clear a chosen colour", async () => {
    const { readFileSync } = await import("node:fs");
    const modal = readFileSync(new URL("../src/components/operator/pro/DesktopSlideEditorModal.tsx", import.meta.url), "utf8");
    assert.match(modal, /Clear colour/, "a chosen black is indistinguishable from none without a way out");
    assert.match(modal, /setBg\(\{ bgColor: "" \}\)/);
  });
  await check("the editor canvas shows transparency as a checkerboard, and only the editor does", async () => {
    const { readFileSync } = await import("node:fs");
    const canvas = readFileSync(new URL("../src/components/operator/editor/SlideCanvas.tsx", import.meta.url), "utf8");
    assert.match(canvas, /EDITOR ONLY/);
    assert.match(canvas, /backgroundPosition: "0 0, 12px 12px"/);
    // The checkerboard must never reach an output surface.
    const renderer = readFileSync(new URL("../src/components/live/SlideRenderer.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(renderer, /12px 12px/, "a transparency checkerboard must never be projected");
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
