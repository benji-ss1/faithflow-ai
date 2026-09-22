/**
 * PP7 "Clear Slide keeps the theme's media" — the rail + Layers panel half.
 * The two surfaces share one adapter (usePp7Layers), so both are checked against
 * the same expectations:
 *   - Slide clear routes through ctx.onClearLiveSlide (the keep-theme decision),
 *     NOT onKill; F2 does the same.
 *   - While the theme is kept (liveSlide = empty + keepThemeBg) the Media row is
 *     LIT and the Slide row is idle, so Clear Media is discoverable.
 *   - Clear Media releases it; Clear All blanks the slide via onKill (NOT the
 *     keep path) and releases it.
 *   - Idle stays fully dark.
 *   - A ctx without the new handlers behaves exactly as before (onKill).
 *
 * Run: npx tsx test/pp7-keep-theme-bg-rail.test.tsx
 */
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import assert from "node:assert/strict";
import Module from "node:module";

const load = (Module as unknown as { _load: (...a: unknown[]) => unknown })._load;
(Module as unknown as { _load: (...a: unknown[]) => unknown })._load = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return {};
  return load.call(this, req, ...rest);
} as never;

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
for (const k of ["window", "document", "navigator", "HTMLElement", "Element", "CustomEvent", "Event", "KeyboardEvent", "MouseEvent", "Node", "Image"] as const) {
  Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true });
}
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as unknown as { React: typeof React }).React = React;

type SlideShape = "text" | "kept" | "idle";

function makeCtx(calls: string[], shape: SlideShape, withHandlers = true) {
  const textLive = shape === "text";
  const mk = (id: string, kind: string) => ({ id, kind, active: id === "slide" && textLive, enabled: true, zone: { kind: "full" } });
  return {
    layersEngineOn: true,
    liveSlide: shape === "text" ? { kind: "text", text: "Amazing grace" }
      : shape === "kept" ? { kind: "empty", keepThemeBg: true }
      : { kind: "empty" },
    announcement: null,
    background: { type: "none" },
    videoInput: null,
    appearance: { logoUrl: null },
    plan: { items: [] },
    liveItemIdx: 0,
    liveLayers: {
      rows: [mk("background", "background"), mk("camera", "camera"), mk("slide", "slide"), mk("logo", "logo")],
      clearLayer: (id: string) => calls.push(`clearLayer:${id}`),
      setZone: () => {},
      isEyeHidden: () => false,
      toggleLayer: () => {},
      clearAll: () => calls.push("clearAll"),
    },
    onKill: () => calls.push("kill"),
    ...(withHandlers ? {
      onClearLiveSlide: () => calls.push("clearLiveSlide(keep)"),
      onReleaseThemeBg: () => calls.push("releaseThemeBg"),
    } : {}),
    onSetAnnouncement: () => calls.push("announcement:null"),
    onClearLowerThird: () => calls.push("lowerThird"),
    onSendSlideToLive: () => {},
  };
}

async function main() {
  const { Pp7ClearRail } = await import("../src/components/operator/pro/right/Pp7ClearRail");
  const { Pp7LayersPanel } = await import("../src/components/operator/pro/right/Pp7LayersPanel");

  let passed = 0, failed = 0;
  const check = (name: string, fn: () => void) => {
    try { fn(); passed++; console.log("  PASS ", name); }
    catch (e) { failed++; console.log("  FAIL ", name); console.error(e); }
  };

  function mount(Comp: unknown, ctx: unknown, extra: Record<string, unknown> = {}) {
    const host = dom.window.document.createElement("div");
    dom.window.document.body.appendChild(host);
    const root = createRoot(host);
    act(() => { root.render(React.createElement(Comp as never, { ctx, messagesActive: false, onClearMessages: () => {}, ...extra } as never)); });
    return { host, root };
  }
  const railBtns = (host: HTMLElement) => [...host.querySelectorAll("button")].slice(0, 7) as HTMLButtonElement[];
  const railIdx = { slide: 4, media: 5 };

  for (const surface of ["rail", "panel"] as const) {
    const Comp = surface === "rail" ? Pp7ClearRail : Pp7LayersPanel;
    const state = (host: HTMLElement) => surface === "rail"
      ? Object.fromEntries(railBtns(host).map((b, i) => [["audio", "messages", "props", "announcements", "slide", "media", "videoInput"][i], b.getAttribute("data-active")]))
      : Object.fromEntries([...host.querySelectorAll("[data-layer]")].map((r) => [r.getAttribute("data-layer"), r.getAttribute("data-active")]));
    const click = (host: HTMLElement, layer: "slide" | "media") => {
      const el = surface === "rail" ? railBtns(host)[railIdx[layer]] : (host.querySelector(`[data-clear="${layer}"]`) as HTMLButtonElement);
      act(() => { el.click(); });
    };
    const clickAll = (host: HTMLElement) => {
      // By LABEL, not index. The rail gained named Clear Groups between the
      // layer rows and Clear All, so an index silently retargets this at a
      // group and then reports Clear All as broken.
      const el = surface === "rail"
        ? ([...host.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") || "").startsWith("Clear All")) as HTMLButtonElement)
        : (host.querySelector('[data-clear="all"]') as HTMLButtonElement);
      act(() => { el.click(); });
    };

    check(`${surface}: Slide clear goes through the keep-theme handler, not onKill`, () => {
      const calls: string[] = [];
      const { host, root } = mount(Comp, makeCtx(calls, "text"));
      click(host, "slide");
      assert.deepEqual(calls, ["clearLiveSlide(keep)"]);
      act(() => root.unmount());
    });

    check(`${surface}: after a Slide clear that kept the theme — Slide idle, Media LIT`, () => {
      const { host, root } = mount(Comp, makeCtx([], "kept"));
      const s = state(host) as Record<string, string>;
      assert.equal(s.slide, "false");
      assert.equal(s.media, "true");
      assert.deepEqual(Object.keys(s).filter((k) => s[k] === "true"), ["media"], "nothing else lights");
      act(() => root.unmount());
    });

    check(`${surface}: Clear Media releases the kept theme background`, () => {
      const calls: string[] = [];
      const { host, root } = mount(Comp, makeCtx(calls, "kept"));
      click(host, "media");
      assert.ok(calls.includes("releaseThemeBg"), `calls: ${calls.join(",")}`);
      assert.ok(!calls.includes("clearLiveSlide(keep)") && !calls.includes("kill"), "Clear Media never touches the slide");
      act(() => root.unmount());
    });

    check(`${surface}: Clear All blanks the slide via onKill (NOT the keep path) and releases the theme`, () => {
      const calls: string[] = [];
      const { host, root } = mount(Comp, makeCtx(calls, "text"));
      clickAll(host);
      assert.ok(calls.includes("kill"), calls.join(","));
      assert.ok(!calls.includes("clearLiveSlide(keep)"), "Clear All must not keep the theme");
      assert.ok(calls.indexOf("releaseThemeBg") > calls.indexOf("kill"), "release after the slide clear");
      act(() => root.unmount());
    });

    check(`${surface}: IDLE is fully dark (nothing ever sent stays plain black)`, () => {
      const { host, root } = mount(Comp, makeCtx([], "idle"));
      const s = state(host) as Record<string, string>;
      assert.deepEqual(Object.keys(s).filter((k) => s[k] === "true"), []);
      act(() => root.unmount());
    });

    check(`${surface}: a ctx WITHOUT the new handlers behaves exactly as before (onKill)`, () => {
      const calls: string[] = [];
      const { host, root } = mount(Comp, makeCtx(calls, "text", false));
      click(host, "slide");
      assert.deepEqual(calls, ["kill"]);
      act(() => root.unmount());
    });
  }

  check("rail F2 -> keep-theme handler; F3 -> release; F1 -> onKill + release", () => {
    const calls: string[] = [];
    const { root } = mount(Pp7ClearRail, makeCtx(calls, "text"));
    const key = (k: string) => act(() => { dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: k, bubbles: true })); });
    key("F2");
    assert.deepEqual(calls, ["clearLiveSlide(keep)"]);
    calls.length = 0; key("F3");
    assert.ok(calls.includes("releaseThemeBg"), calls.join(","));
    calls.length = 0; key("F1");
    assert.ok(calls.includes("kill") && !calls.includes("clearLiveSlide(keep)"), calls.join(","));
    act(() => root.unmount());
  });

  console.log(`\nPP7 keep theme background (rail + panel): ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
