/**
 * Runtime test — BottomBar remains the transition publisher after the visible
 * bottom-bar chooser/slider was removed (2026-09-15).
 *
 * Mounts the real BottomBar in jsdom with a mock onSetTransitionSpec. Each mount
 * case asserts EXACTLY ONE publish (guards the old bug where the defaults were
 * published first and then overrode the saved value), plus event re-apply,
 * off → null, Cut → null, and that the chooser/slider are gone.
 *
 * Run: npx tsx test/transition-publish.test.tsx
 */
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import assert from "node:assert/strict";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
for (const k of ["window", "document", "navigator", "HTMLElement", "Element", "CustomEvent", "Event"] as const) {
  Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true });
}
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// tsx compiles the component's JSX with the classic runtime (tsconfig jsx: preserve).
(globalThis as unknown as { React: typeof React }).React = React;

type Spec = { effectId: string; durationMs: number; easing?: string; name?: string } | null;
const AMOEBA_DEFAULT = { effectId: "dissolve", durationMs: 600, easing: "ease-in-out", name: "Amoeba" };

async function main() {
  const { BottomBar, TRANSITION_KEY, TRANSITION_UPDATED_EVENT } = await import("../src/components/operator/pro/BottomBar");

  let passed = 0;
  let failed = 0;
  const check = async (name: string, fn: () => void | Promise<void>) => {
    try { await fn(); passed++; console.log("  PASS ", name); }
    catch (e) { failed++; console.log("  FAIL ", name); console.error(e); }
  };

  /** Fresh mount with `stored` in TRANSITION_KEY (undefined = key absent). */
  async function mount(stored: string | undefined) {
    window.localStorage.clear();
    if (stored !== undefined) window.localStorage.setItem(TRANSITION_KEY, stored);
    const calls: Spec[] = [];
    const ctx = {
      plan: { items: [] }, previewItemIdx: 0, previewSlideIdx: 0, liveSlide: null,
      onJumpSlide() {}, onSendSlideToLive() {}, onSendToLive() {}, onBlank() {},
      onSetTransitionSpec: (s: Spec) => { calls.push(s); },
    } as unknown as Parameters<typeof BottomBar>[0]["ctx"];
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root: Root = createRoot(el);
    await act(async () => { root.render(<BottomBar ctx={ctx} centerMode="slides" />); });
    const unmount = async () => { await act(async () => { root.unmount(); }); el.remove(); };
    return { calls, el, unmount };
  }

  const fire = async (detail: object) => {
    await act(async () => { window.dispatchEvent(new CustomEvent(TRANSITION_UPDATED_EVENT, { detail })); });
  };

  await check("saved Fade/800 → exactly ONE publish, with the saved spec", async () => {
    const m = await mount(JSON.stringify({ name: "Fade", durationMs: 800 }));
    try {
      assert.deepEqual(m.calls, [{ effectId: "fade_in", durationMs: 800, easing: "ease-in-out", name: "Fade" }]);
      assert.equal(m.el.querySelector("input[type=range]"), null, "speed slider must not render");
      assert.ok(!/Speed:/i.test(m.el.textContent ?? ""), "speed label must not render");
    } finally { await m.unmount(); }
  });

  await check("nothing saved → exactly one publish of the Amoeba 0.6s default", async () => {
    const m = await mount(undefined);
    try { assert.deepEqual(m.calls, [AMOEBA_DEFAULT]); } finally { await m.unmount(); }
  });

  await check("corrupt JSON → defaults, no throw", async () => {
    const m = await mount("{not json");
    try { assert.deepEqual(m.calls, [AMOEBA_DEFAULT]); } finally { await m.unmount(); }
  });

  await check("stored value null → defaults", async () => {
    const m = await mount("null");
    try { assert.deepEqual(m.calls, [AMOEBA_DEFAULT]); } finally { await m.unmount(); }
  });

  await check("legacy shape {duration: seconds} → correct ms", async () => {
    const m = await mount(JSON.stringify({ name: "Wipe", duration: 1.5 }));
    try { assert.deepEqual(m.calls, [{ effectId: "wipe_right", durationMs: 1500, easing: "ease-in-out", name: "Wipe" }]); }
    finally { await m.unmount(); }
  });

  await check("saved off:true → exactly one null publish", async () => {
    const m = await mount(JSON.stringify({ name: "Fade", durationMs: 800, off: true }));
    try { assert.deepEqual(m.calls, [null]); } finally { await m.unmount(); }
  });

  await check("TRANSITION_UPDATED_EVENT re-applies; off → null; Cut → null; state persisted", async () => {
    const m = await mount(JSON.stringify({ name: "Fade", durationMs: 800 }));
    const last = () => m.calls[m.calls.length - 1];
    try {
      await fire({ name: "Dissolve", durationMs: 1200, off: false });
      assert.deepEqual(last(), { effectId: "cross_fade", durationMs: 1200, easing: "ease-in-out", name: "Dissolve" });
      await fire({ off: true });
      assert.equal(last(), null);
      await fire({ name: "Slide (L→R)", off: false });
      assert.equal(last()?.effectId, "slide_right");
      await fire({ name: "Cut" });
      assert.equal(last(), null);
      assert.deepEqual(JSON.parse(window.localStorage.getItem(TRANSITION_KEY)!), { name: "Cut", durationMs: 1200, off: false });
    } finally { await m.unmount(); }
  });

  console.log(`\ntransition-publish: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
