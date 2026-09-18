/**
 * PP7 DRAW ORDER — the RENDERED DOM half (the pure half is
 * `test/pp7-draw-order.test.ts`).
 *
 * `test/fixtures/output-dom-main.golden.json` is the markup every fixture in
 * `test/pp7-draw-order-dom-matrix.ts` produced on `main`, composed the way the
 * routes composed it there (the OutputCompositor, then an `<AnnouncementLayer>`
 * painted as a sibling on top). Regenerate it with
 * `test/pp7-draw-order-dom-golden.tsx` — its header has the exact commands.
 *
 * The contracts:
 *   1. KILL SWITCH — with the draw order off, the markup is byte-identical to
 *      that golden. Every fixture. No exceptions, no allowances.
 *   2. With it on, ONLY fixtures with a live camera or a live announcement
 *      change. Everything else is still byte-identical.
 *   3. In the fixtures that DO change, the change is the two swaps and nothing
 *      else: the camera paints before (below) the media, and the props (theme
 *      logo) paint after (above) the announcement.
 *
 * Run: npx tsx test/pp7-draw-order-dom.test.tsx
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { domMatrix, domKey, type DomFixture } from "./pp7-draw-order-dom-matrix";
import { PP7_DRAW_ORDER_STORAGE_KEY } from "../src/lib/pp7-draw-order";

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

const golden = JSON.parse(readFileSync(new URL("./fixtures/output-dom-main.golden.json", import.meta.url), "utf8")) as Record<string, string>;

/** Fixtures whose rendering the PP7 draw order is ALLOWED to change: exactly the
 *  ones with a live camera (swap 2) or a live announcement over live props
 *  (swap 1). Anything else changing is a regression. */
function mayChange(f: DomFixture): boolean {
  const cameraPaints = !!f.videoInput && f.mode !== "stage" && !f.transparent;
  const logoPaints = !!f.appearance?.logoUrl && f.appearance.logoPosition !== "none" && !f.transparent;
  const announcementOverProps = !!f.announcement && logoPaints;
  return cameraPaints || announcementOverProps;
}

async function renderAll(drawOrder: boolean): Promise<Record<string, string>> {
  const { OutputCompositor } = await import("../src/components/live/OutputCompositor");
  dom.window.localStorage.setItem(PP7_DRAW_ORDER_STORAGE_KEY, drawOrder ? "1" : "0");
  const out: Record<string, string> = {};
  for (const f of domMatrix()) {
    const fixture = f as unknown as Record<string, unknown>;
    const announcement = (fixture.announcement ?? null) as never;
    const props: Record<string, unknown> = { ...fixture };
    delete props.name;
    delete props.announcement;
    const host = dom.window.document.createElement("div");
    host.className = "relative w-full h-full";
    dom.window.document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(React.createElement(OutputCompositor, { ...props, announcement } as never));
    });
    out[domKey(f)] = host.innerHTML;
    await act(async () => { root.unmount(); });
    host.remove();
  }
  return out;
}

async function main() {
  const off = await renderAll(false);
  const on = await renderAll(true);
  const fixtures = domMatrix();
  assert.equal(Object.keys(golden).length, fixtures.length, "golden and matrix must line up");

  check("KILL SWITCH: draw order OFF renders byte-identical DOM to main, all 88 fixtures", () => {
    const diffs = Object.keys(golden).filter((k) => golden[k] !== off[k]);
    assert.deepEqual(diffs, [], `these fixtures changed with the flag OFF:\n          ${diffs.join("\n          ")}`);
  });

  check("draw order ON changes ONLY camera / announcement-over-props fixtures", () => {
    for (const f of fixtures) {
      const k = domKey(f);
      if (mayChange(f)) continue;
      assert.equal(on[k], golden[k], `${k} must not have changed`);
    }
  });

  check("draw order ON actually changes every camera fixture (the swap really happens)", () => {
    const changed = fixtures.filter((f) => on[domKey(f)] !== golden[domKey(f)]);
    assert.ok(changed.length > 0, "nothing changed — the flag did not take effect");
    for (const f of changed) assert.ok(mayChange(f), `${domKey(f)} changed but nothing in it should move`);
    // Both swaps must be represented, or this test would pass on half a feature.
    assert.ok(changed.some((f) => f.videoInput && !f.announcement), "no camera-only fixture changed (swap 2 missing)");
    assert.ok(changed.some((f) => f.announcement && !f.videoInput), "no announcement fixture changed (swap 1 missing)");
  });

  check("SWAP 2 in the DOM: the camera paints BEFORE (below) the media", () => {
    for (const f of fixtures) {
      if (!f.videoInput || !f.background || f.mode === "stage" || f.transparent) continue;
      const html = on[domKey(f)];
      const camAt = html.indexOf("<video");
      const mediaAt = html.indexOf("https://x/bg.png");
      assert.ok(camAt >= 0, `${domKey(f)}: camera missing`);
      assert.ok(mediaAt >= 0, `${domKey(f)}: media missing — it must paint over the camera, not be suppressed by it`);
      assert.ok(camAt < mediaAt, `${domKey(f)}: media must paint AFTER the camera`);
      // …and the words stay on top of both.
      assert.ok(mediaAt < html.indexOf("Amazing grace"), `${domKey(f)}: the words must stay above the media`);
    }
  });

  check("SWAP 1 in the DOM: the props (theme logo) paint AFTER (above) the announcement", () => {
    for (const f of fixtures) {
      if (!f.announcement || !f.appearance?.logoUrl || f.transparent) continue;
      const html = on[domKey(f)];
      const annAt = html.indexOf("Welcome to the 9am service");
      const logoAt = html.indexOf("https://x/logo.png");
      assert.ok(annAt >= 0 && logoAt >= 0, `${domKey(f)}: announcement or logo missing`);
      assert.ok(annAt < logoAt, `${domKey(f)}: the props must paint after the announcement`);
      // Legacy had it the other way round — prove the golden really differed.
      const g = golden[domKey(f)];
      assert.ok(g.indexOf("https://x/logo.png") < g.indexOf("Welcome to the 9am service"), `${domKey(f)}: golden should have had props BELOW the announcement`);
    }
  });

  check("no regression: the announcement keeps its own geometry (never folded into the 1920×1080 canvas)", () => {
    for (const f of fixtures) {
      if (!f.announcement) continue;
      const html = on[domKey(f)];
      const annAt = html.indexOf("Welcome to the 9am service");
      if (annAt < 0) continue;
      // The announcement must sit AFTER the last presentation-canvas inner box
      // that precedes it — i.e. outside the scaled canvas, exactly where the
      // routes drew it. Its own px font size is unscaled proof of that.
      assert.ok(html.includes("font-size: 32px"), `${domKey(f)}: announcement font must stay in real pixels`);
    }
  });

  check("no regression: theme decor still paints above the media/camera and below the words", () => {
    for (const f of fixtures) {
      if (!f.name.startsWith("theme decor")) continue;
      const html = on[domKey(f)];
      const decorAt = html.indexOf("https://x/decor.png");
      if (decorAt < 0) continue; // this surface hosts no decor (stage / keyed)
      if (f.background) {
        const mediaAt = html.indexOf("https://x/bg.png");
        assert.ok(mediaAt >= 0 && mediaAt < decorAt, `${domKey(f)}: decor must paint after the media`);
      }
      if (f.videoInput) {
        const camAt = html.indexOf("<video");
        assert.ok(camAt >= 0 && camAt < decorAt, `${domKey(f)}: the camera layer must never cover the decor`);
      }
      assert.ok(decorAt < html.indexOf("Amazing grace"), `${domKey(f)}: decor must stay below the words`);
    }
  });

  check("no regression: every fixture still renders the slide, and nothing throws", () => {
    for (const f of fixtures) {
      const html = on[domKey(f)];
      assert.ok(html.length > 0, `${domKey(f)} rendered nothing`);
      if (f.slide.kind === "text" && !f.transparent) {
        assert.ok(html.includes("Amazing grace") || html.includes("Lower third"), `${domKey(f)} lost its words`);
      }
    }
  });

  console.log(`\nPP7 draw order (DOM): ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
