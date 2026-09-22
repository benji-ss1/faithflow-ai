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
  check("rail renders 7 PP7 rows in order + Clear Groups + Clear All", () => {
    const { host, root } = mount(false);
    const btns = [...host.querySelectorAll("button")];
    // 7 layer rows + named Clear Groups + the circled Clear All. "Clear to
    // Logo" is hidden here because this mount has no church logo, which is
    // deliberate — see pp7-clear-groups.test.ts.
    assert.equal(btns.length, 9, "7 layers + 1 visible Clear Group + Clear All");
    const abv = btns.find((b) => (b.getAttribute("aria-label") || "").startsWith("All But Video Input"));
    assert.ok(abv, "the IMAG clear group must be on the rail");
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
    // Second binding shown per platform (jsdom UA is not Mac → Ctrl+Shift+C).
    // By label, not index: the rail gains buttons over time and an index here
    // silently starts asserting about a different control.
    const clearAll = btns.find((b) => (b.getAttribute("aria-label") || "").startsWith("Clear All"));
    assert.equal(clearAll?.getAttribute("aria-label"), "Clear All (F1 or Ctrl+Shift+C)");
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
    const all = [...host.querySelectorAll("button")]
      .find((b) => (b.getAttribute("aria-label") || "").startsWith("Clear All"))!;
    assert.ok(all, "Clear All must be findable by label, not position");
    calls.length = 0;
    act(() => { all.click(); });
    assert.deepEqual(calls, [
      "clearMessages", "clearLayer:logo", "announcement:null", "kill", "clearLayer:background", "lowerThird",
    ]);
    act(() => root.unmount());
  });

  // 6b. Guard: a MENU / popover must NOT block a clear key; a MODAL dialog must.
  check("F-keys survive an open menu/popover, but a modal dialog blocks them", () => {
    const { root, calls } = mount(true);
    const doc = dom.window.document;
    const key = (k: string) => {
      calls.length = 0;
      act(() => { dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: k, bubbles: true })); });
      return [...calls];
    };
    const add = (role: string, modal: boolean) => {
      const el = doc.createElement("div");
      el.setAttribute("role", role);
      el.setAttribute("data-state", "open");
      if (modal) el.setAttribute("aria-modal", "true");
      doc.body.appendChild(el);
      return el;
    };
    // A dropdown menu (the Messages popover case) — F6 must still clear.
    const menu = add("menu", false);
    assert.deepEqual(key("F6"), ["clearMessages"], "an open menu does not block F6");
    menu.remove();
    // A select listbox — still fires.
    const listbox = add("listbox", false);
    assert.deepEqual(key("F4"), ["clearLayer:logo"], "an open listbox does not block F4");
    listbox.remove();
    // A non-modal popover (role=dialog, no aria-modal) — still fires.
    const pop = add("dialog", false);
    assert.deepEqual(key("F2"), ["kill"], "a non-modal popover does not block F2");
    pop.remove();
    // A genuinely modal dialog — blocked.
    const modal = add("dialog", true);
    assert.deepEqual(key("F2"), [], "a modal dialog blocks the clear keys");
    modal.remove();
    const alert = add("alertdialog", false);
    assert.deepEqual(key("F2"), [], "an alert dialog blocks the clear keys");
    alert.remove();
    assert.deepEqual(key("F2"), ["kill"], "and it works again once the dialog closes");
    act(() => root.unmount());
  });

  // 6c. F5 must never reach the browser (page reload mid-service).
  check("F5 is prevented (no reload) and is a no-op", () => {
    const { root, calls } = mount(true);
    calls.length = 0;
    const e = new dom.window.KeyboardEvent("keydown", { key: "F5", bubbles: true, cancelable: true });
    act(() => { dom.window.dispatchEvent(e); });
    assert.equal(e.defaultPrevented, true, "F5 is preventDefault-ed so the browser cannot reload");
    assert.deepEqual(calls, [], "…and clears nothing (no audio layer yet)");
    act(() => root.unmount());
  });

  // 6d. Second Clear All binding for Macs where F1 is the brightness key.
  check("Cmd/Ctrl+Shift+C is a second Clear All; F1 still works", () => {
    const { root, calls } = mount(true);
    const chord = (mod: "metaKey" | "ctrlKey") => {
      calls.length = 0;
      act(() => {
        dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "C", shiftKey: true, [mod]: true, bubbles: true }));
      });
      return [...calls];
    };
    assert.equal(chord("metaKey").includes("lowerThird"), true, "⌘⇧C clears all");
    assert.equal(chord("ctrlKey").includes("lowerThird"), true, "Ctrl+Shift+C clears all");
    calls.length = 0;
    act(() => { dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "F1", bubbles: true })); });
    assert.equal(calls.includes("lowerThird"), true, "F1 unchanged");
    act(() => root.unmount());
  });

  // 6e. Audio reads as unavailable, not as a working button.
  check("Audio cell is visibly unavailable in the rail", () => {
    const { host, root } = mount(true);
    const audio = [...host.querySelectorAll("button")][0];
    assert.equal(audio.getAttribute("aria-disabled"), "true");
    assert.equal(audio.getAttribute("aria-label"), "Audio (coming soon)");
    assert.equal(audio.getAttribute("tabindex"), "-1", "not in the tab order");
    assert.equal(/cursor-not-allowed/.test(audio.className), true);
    assert.equal(audio.querySelector("[aria-hidden]") !== null, true, "has the visible strike");
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
