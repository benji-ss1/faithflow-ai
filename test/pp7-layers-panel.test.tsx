/**
 * Pp7LayersPanel — PP7 rows/labels/order, per-layer clear parity with the rail,
 * no legacy affordances (eye / hold-to-clear / "lit = live"), and the flag-off
 * path still rendering the legacy LayersPanel unchanged.
 *
 * Run: npx tsx test/pp7-layers-panel.test.tsx
 */
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import assert from "node:assert/strict";
import Module from "node:module";

// The panel imports the shared media-upload helper, which transitively reaches a
// `server-only`-marked module. Stub it so the CLIENT component can be mounted in
// node (the real boundary is enforced by Next at build time, not here).
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

function makeCtx(calls: string[], live: boolean) {
  const mk = (id: string, kind: string) => ({ id, kind, active: live, enabled: true, zone: { kind: "full" } });
  return {
    layersEngineOn: true,
    liveSlide: live ? { kind: "text", text: "Amazing grace" } : null,
    announcement: live ? { text: "hi" } : null,
    background: live ? { type: "image", imageUrl: "x" } : { type: "none" },
    videoInput: live ? { deviceId: "cam1", label: "Cam" } : null,
    appearance: { logoUrl: null },
    plan: { items: [] },
    liveItemIdx: 0,
    liveLayers: {
      rows: [mk("background", "background"), mk("camera", "camera"), mk("slide", "slide"), mk("logo", "logo")],
      clearLayer: (id: string) => calls.push(`clearLayer:${id}`),
      setZone: (id: string) => calls.push(`setZone:${id}`),
      isEyeHidden: () => false,
      toggleLayer: (id: string) => calls.push(`toggle:${id}`),
      clearAll: () => calls.push("clearAll"),
    },
    onKill: () => calls.push("kill"),
    onSetAnnouncement: () => calls.push("announcement:null"),
    onClearLowerThird: () => calls.push("lowerThird"),
    onSendSlideToLive: () => calls.push("send"),
  };
}

async function main() {
  const { Pp7LayersPanel } = await import("../src/components/operator/pro/right/Pp7LayersPanel");
  const { LayersPanel } = await import("../src/components/operator/pro/right/LayersPanel");

  let passed = 0, failed = 0;
  const check = (name: string, fn: () => void) => {
    try { fn(); passed++; console.log("  PASS ", name); }
    catch (e) { failed++; console.log("  FAIL ", name); console.error(e); }
  };

  function mount(Comp: unknown, props: Record<string, unknown>) {
    const host = dom.window.document.createElement("div");
    dom.window.document.body.appendChild(host);
    const root = createRoot(host);
    act(() => { root.render(React.createElement(Comp as never, props as never)); });
    return { host, root };
  }

  function mountPanel(live: boolean) {
    const calls: string[] = [];
    const { host, root } = mount(Pp7LayersPanel, {
      ctx: makeCtx(calls, live),
      messagesActive: live,
      onClearMessages: () => calls.push("clearMessages"),
    });
    return { host, root, calls };
  }

  // 1. Rows, order, labels.
  check("panel renders the 7 PP7 rows in PP7 order", () => {
    const { host, root } = mountPanel(false);
    const rows = [...host.querySelectorAll("[data-layer]")];
    assert.deepEqual(rows.map((r) => r.getAttribute("data-layer")),
      ["audio", "messages", "props", "announcements", "slide", "media", "videoInput"]);
    const text = host.textContent ?? "";
    for (const label of ["Audio", "Messages", "Props", "Announcements", "Slide", "Media", "Video Input"]) {
      assert.equal(text.includes(label), true, `shows ${label}`);
    }
    act(() => root.unmount());
  });

  // 2. No legacy naming or legacy affordances.
  check("no Background / Camera / Logo naming, no eye, no hold-to-clear, no 'lit = live'", () => {
    const { host, root } = mountPanel(true);
    const text = host.textContent ?? "";
    for (const bad of ["Background", "Camera", "lit = live", "Hold", "Cleared"]) {
      assert.equal(text.includes(bad), false, `panel must not say "${bad}"`);
    }
    const aria = [...host.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label") ?? "");
    assert.equal(aria.some((a) => /^(Hide|Show|Re-enable) /.test(a)), false, "no eye hide/show buttons");
    act(() => root.unmount());
  });

  // 3. Live indicators mirror the model.
  check("live: every available layer shows as live; audio never does", () => {
    const { host, root } = mountPanel(true);
    const state = Object.fromEntries([...host.querySelectorAll("[data-layer]")]
      .map((r) => [r.getAttribute("data-layer"), r.getAttribute("data-active")]));
    assert.deepEqual(state, {
      audio: "false", messages: "true", props: "true", announcements: "true",
      slide: "true", media: "true", videoInput: "true",
    });
    act(() => root.unmount());
  });

  // 4. Per-row clear = the same effects the rail's row produces.
  check("each row's clear fires the same action as the rail's", () => {
    const { host, root, calls } = mountPanel(true);
    const clearBtn = (l: string) => host.querySelector(`[data-clear="${l}"]`) as HTMLButtonElement;
    const fire = (l: string) => { calls.length = 0; act(() => { clearBtn(l).click(); }); return [...calls]; };
    assert.deepEqual(fire("audio"), [], "audio inert (disabled)");
    assert.deepEqual(fire("messages"), ["clearMessages"]);
    assert.deepEqual(fire("props"), ["clearLayer:logo"]);
    assert.deepEqual(fire("announcements"), ["announcement:null"]);
    assert.deepEqual(fire("slide"), ["kill"]);
    assert.deepEqual(fire("media"), ["clearLayer:background"]);
    assert.deepEqual(fire("videoInput"), [], "video input clear goes through clearVideoInputLive");
    act(() => root.unmount());
  });

  // 5. Clear All matches the rail's Clear All exactly.
  check("Clear All (circled ✕) runs every per-layer clear then the lower third", () => {
    const { host, root, calls } = mountPanel(true);
    const all = host.querySelector('[data-clear="all"]') as HTMLButtonElement;
    assert.equal(all.getAttribute("aria-label"), "Clear All (F1)");
    calls.length = 0;
    act(() => { all.click(); });
    assert.deepEqual(calls, [
      "clearMessages", "clearLayer:logo", "announcement:null", "kill", "clearLayer:background", "lowerThird",
    ]);
    act(() => root.unmount());
  });

  // 6. The kept controls are present and PP7-named.
  check("keeps media swap, props picker, slide zone and slide actions", () => {
    const { host, root } = mountPanel(true);
    const aria = [...host.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label"));
    assert.equal(aria.includes("Change media"), true, "Media swap picker");
    assert.equal(aria.includes("Choose prop (church logo)"), true, "Props (logo) picker");
    assert.equal(aria.includes("Slide actions"), true, "Slide actions");
    assert.equal(aria.some((a) => (a ?? "").includes("lower third")), true, "slide zone Full/Lower-third");
    act(() => root.unmount());
  });

  // 7. Windows: F-key hints, no ⌘-only labels, and the panel scrolls.
  check("Windows: F-key labels, no ⌘/Cmd-only labels, scrolls not overflows", () => {
    const { host, root } = mountPanel(true);
    const titles = [...host.querySelectorAll("[title]")].map((e) => e.getAttribute("title") ?? "");
    assert.equal(titles.some((t) => t.includes("(F2)")), true, "Slide clear names F2");
    assert.equal(titles.some((t) => t.includes("(F1)")), true, "Clear All names F1");
    for (const t of titles) assert.equal(/⌘|Cmd\+/.test(t), false, `no ⌘-only label: ${t}`);
    const scroller = host.firstElementChild as HTMLElement;
    assert.equal(/overflow-y-auto/.test(scroller.className), true, "panel scrolls");
    act(() => root.unmount());
  });

  // 8. Off-air state — nothing lit, clears are still safe to press.
  check("idle: no layer is lit", () => {
    const { host, root } = mountPanel(false);
    const lit = [...host.querySelectorAll('[data-layer][data-active="true"]')];
    assert.equal(lit.length, 0);
    act(() => root.unmount());
  });

  // 9. Flag-off parity: the legacy panel still renders exactly as today.
  check("flag off: the legacy LayersPanel is unchanged (eye + hold-to-clear + legend)", () => {
    const calls: string[] = [];
    const { host, root } = mount(LayersPanel, { ctx: makeCtx(calls, true) });
    const text = host.textContent ?? "";
    assert.equal(text.includes("lit = live"), true, "legacy legend still there");
    assert.equal(text.includes("Background"), true, "legacy Background row still there");
    assert.equal(text.includes("Camera"), true, "legacy Camera row still there");
    const aria = [...host.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label") ?? "");
    assert.equal(aria.some((a) => a.startsWith("Hide ")), true, "legacy eye toggles still there");
    assert.equal(aria.some((a) => a.startsWith("Clear ")), true, "legacy per-layer clears still there");
    act(() => root.unmount());
  });

  console.log(`pp7-layers-panel: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

void main();
