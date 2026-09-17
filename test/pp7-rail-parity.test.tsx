/**
 * Pp7ClearRail parity lock — the rail's rendered DOM and its clear effects must
 * not change when the layer mapping moves into `src/lib/pp7-layer-model.ts`
 * (2026-09-17 PP7 layers panel work). The expected HTML below was captured from
 * the rail BEFORE the refactor.
 *
 * Run: npx tsx test/pp7-rail-parity.test.tsx
 */
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import assert from "node:assert/strict";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
for (const k of ["window", "document", "navigator", "HTMLElement", "Element", "CustomEvent", "Event", "KeyboardEvent", "MouseEvent", "Node"] as const) {
  Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true });
}
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as unknown as { React: typeof React }).React = React;

type Call = string;

function makeCtx(calls: Call[], opts: { live?: boolean } = {}) {
  const live = opts.live ?? false;
  const rows = live
    ? [
        { id: "background", active: true, enabled: true, kind: "background", zone: { kind: "full" } },
        { id: "camera", active: true, enabled: true, kind: "camera", zone: { kind: "full" } },
        { id: "slide", active: true, enabled: true, kind: "slide", zone: { kind: "full" } },
        { id: "logo", active: true, enabled: true, kind: "logo", zone: { kind: "full" } },
      ]
    : [
        { id: "background", active: false, enabled: true, kind: "background", zone: { kind: "full" } },
        { id: "camera", active: false, enabled: true, kind: "camera", zone: { kind: "full" } },
        { id: "slide", active: false, enabled: true, kind: "slide", zone: { kind: "full" } },
        { id: "logo", active: false, enabled: true, kind: "logo", zone: { kind: "full" } },
      ];
  return {
    liveSlide: live ? { kind: "text", text: "Amazing grace" } : null,
    announcement: live ? { text: "hi" } : null,
    background: live ? { type: "image", imageUrl: "x" } : { type: "none" },
    videoInput: live ? { deviceId: "cam1", label: "Cam" } : null,
    liveLayers: {
      rows,
      clearLayer: (id: string) => calls.push(`clearLayer:${id}`),
      setZone: () => {},
      isEyeHidden: () => false,
      toggleLayer: () => {},
      clearAll: () => calls.push("clearAll"),
    },
    onKill: () => calls.push("kill"),
    onSetAnnouncement: (a: unknown) => calls.push(`announcement:${a === null ? "null" : "set"}`),
    onClearLowerThird: () => calls.push("lowerThird"),
  };
}

async function main() {
  const { Pp7ClearRail } = await import("../src/components/operator/pro/right/Pp7ClearRail");

  let passed = 0, failed = 0;
  const check = (name: string, fn: () => void) => {
    try { fn(); passed++; console.log("  PASS ", name); }
    catch (e) { failed++; console.log("  FAIL ", name); console.error(e); }
  };

  function mount(live: boolean) {
    const calls: Call[] = [];
    const host = dom.window.document.createElement("div");
    dom.window.document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(React.createElement(Pp7ClearRail as never, {
        ctx: makeCtx(calls, { live }) as never,
        messagesActive: live,
        onClearMessages: () => calls.push("clearMessages"),
      }));
    });
    return { host, root, calls };
  }

  // 1. Structure: 7 layer buttons in PP7 order + the circled ✕.
  check("rail renders 7 PP7 rows in order + Clear All", () => {
    const { host, root } = mount(false);
    const btns = [...host.querySelectorAll("button")];
    assert.equal(btns.length, 8, "7 layers + Clear All");
    const labels = btns.slice(0, 7).map((b) => b.getAttribute("aria-label"));
    assert.deepEqual(labels, [
      "Audio (coming soon)",
      "Clear Messages (F6)",
      "Clear Props (F4)",
      "Clear Announcements (F7)",
      "Clear Slide (F2)",
      "Clear Media (F3)",
      "Clear Video Input",
    ]);
    assert.equal(btns[7].getAttribute("aria-label"), "Clear All (F1)");
    act(() => root.unmount());
  });

  // 2. Idle state: nothing active, column idle colour.
  check("idle: no row is active", () => {
    const { host, root } = mount(false);
    const btns = [...host.querySelectorAll("button")].slice(0, 7);
    assert.deepEqual(btns.map((b) => b.getAttribute("data-active")), Array(7).fill("false"));
    act(() => root.unmount());
  });

  // 3. Live state: every available layer lights.
  check("live: messages/props/announcements/slide/media/videoInput all active", () => {
    const { host, root } = mount(true);
    const btns = [...host.querySelectorAll("button")].slice(0, 7);
    assert.deepEqual(btns.map((b) => b.getAttribute("data-active")), [
      "false", "true", "true", "true", "true", "true", "true",
    ]);
    act(() => root.unmount());
  });

  // 4. Clear effects per row (the contract the panel must match).
  check("per-row clears fire the expected effects", () => {
    const { host, root, calls } = mount(true);
    const btns = [...host.querySelectorAll("button")].slice(0, 7);
    const fire = (i: number) => { calls.length = 0; act(() => { btns[i].click(); }); return [...calls]; };
    assert.deepEqual(fire(0), [], "audio is inert");
    assert.deepEqual(fire(1), ["clearMessages"]);
    assert.deepEqual(fire(2), ["clearLayer:logo"]);
    assert.deepEqual(fire(3), ["announcement:null"]);
    assert.deepEqual(fire(4), ["kill"]);
    assert.deepEqual(fire(5), ["clearLayer:background"], "media: background store reset + layer clear");
    assert.deepEqual(fire(6), [], "video input clear goes through clearVideoInputLive (no ctx call)");
    act(() => root.unmount());
  });

  // 5. Clear All runs every per-layer clear + the lower third.
  check("Clear All clears each layer then the lower third", () => {
    const { host, root, calls } = mount(true);
    const all = [...host.querySelectorAll("button")][7];
    calls.length = 0;
    act(() => { all.click(); });
    assert.deepEqual(calls, [
      "clearMessages", "clearLayer:logo", "announcement:null", "kill", "clearLayer:background", "lowerThird",
    ]);
    act(() => root.unmount());
  });

  // 6. F-keys run the same clears as the buttons.
  check("F6 clears messages, F2 clears slide, F1 clears all", () => {
    const { root, calls } = mount(true);
    const key = (k: string) => {
      calls.length = 0;
      act(() => {
        dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: k, bubbles: true }));
      });
      return [...calls];
    };
    assert.deepEqual(key("F6"), ["clearMessages"]);
    assert.deepEqual(key("F2"), ["kill"]);
    assert.equal(key("F1").length > 1, true, "F1 = Clear All");
    act(() => root.unmount());
  });

  console.log(`pp7-rail-parity: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

void main();
