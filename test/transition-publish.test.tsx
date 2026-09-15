/**
 * Runtime test — BottomBar remains the transition publisher after the visible
 * bottom-bar chooser/slider was removed (2026-09-15).
 *
 * Mounts the real BottomBar in jsdom with a mock onSetTransitionSpec and asserts:
 *   1. a saved {name:"Fade",durationMs:800} is applied on mount (fade_in / 800)
 *   2. TRANSITION_UPDATED_EVENT (what TransitionsPanel fires) re-applies
 *   3. off:true → null
 *   4. Cut → null
 *   5. the chooser / speed slider are no longer rendered
 */
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import assert from "node:assert/strict";

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
for (const k of ["window", "document", "navigator", "HTMLElement", "Element", "CustomEvent", "Event", "localStorage"] as const) {
  Object.defineProperty(globalThis, k, { value: k === "localStorage" ? dom.window.localStorage : dom.window[k], configurable: true });
}
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// tsx compiles the component's JSX with the classic runtime (tsconfig jsx: preserve).
(globalThis as unknown as { React: typeof React }).React = React;

async function main() {
  const { BottomBar, TRANSITION_KEY, TRANSITION_UPDATED_EVENT } = await import("../src/components/operator/pro/BottomBar");
  type Spec = { effectId: string; durationMs: number; name?: string } | null;
  const calls: Spec[] = [];
  const last = () => calls[calls.length - 1];

  window.localStorage.setItem(TRANSITION_KEY, JSON.stringify({ name: "Fade", durationMs: 800 }));

  const ctx = {
    plan: { items: [] }, previewItemIdx: 0, previewSlideIdx: 0, liveSlide: null,
    onJumpSlide() {}, onSendSlideToLive() {}, onSendToLive() {}, onBlank() {},
    onSetTransitionSpec: (s: Spec) => { calls.push(s); },
  } as unknown as Parameters<typeof BottomBar>[0]["ctx"];

  const root = createRoot(document.getElementById("root")!);
  await act(async () => { root.render(<BottomBar ctx={ctx} centerMode="slides" />); });

  let passed = 0;
  const check = (name: string, fn: () => void) => { fn(); passed++; console.log("  ok -", name); };

  check("saved Fade/800 applied on mount", () => {
    assert.deepEqual(last(), { effectId: "fade_in", durationMs: 800, easing: "ease-in-out", name: "Fade" });
  });
  check("chooser + speed slider not rendered", () => {
    assert.equal(document.querySelector("input[type=range]"), null);
    assert.ok(!/Speed:/i.test(document.body.textContent ?? ""));
  });

  const fire = async (detail: object) => {
    await act(async () => { window.dispatchEvent(new CustomEvent(TRANSITION_UPDATED_EVENT, { detail })); });
  };

  await fire({ name: "Dissolve", durationMs: 1200, off: false });
  check("TRANSITION_UPDATED_EVENT re-applies", () => {
    assert.deepEqual(last(), { effectId: "cross_fade", durationMs: 1200, easing: "ease-in-out", name: "Dissolve" });
  });

  await fire({ off: true });
  check("off:true → null", () => assert.equal(last(), null));

  await fire({ name: "Slide (L→R)", off: false });
  check("back on → slide_right", () => assert.equal(last()?.effectId, "slide_right"));

  await fire({ name: "Cut" });
  check("Cut → null", () => assert.equal(last(), null));

  check("persisted state still written", () => {
    assert.deepEqual(JSON.parse(window.localStorage.getItem(TRANSITION_KEY)!), { name: "Cut", durationMs: 1200, off: false });
  });

  await act(async () => { root.unmount(); });
  console.log(`transition-publish: ${passed} passed`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
