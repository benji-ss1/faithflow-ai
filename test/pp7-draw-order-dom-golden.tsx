/**
 * Regenerates `test/fixtures/output-dom-main.golden.json` — the RENDERED DOM of
 * every fixture in `test/pp7-draw-order-dom-matrix.ts`, as the four output
 * routes composed it on `main` BEFORE the PP7 draw-order change (2026-09-18).
 *
 * Not a test (no `.test.` in the name, so the runner skips it); it is the tool
 * that MAKES the evidence `test/pp7-draw-order-dom.test.tsx` checks against.
 *
 * How the golden was captured (and how to re-capture it):
 *
 *   git worktree add /tmp/ff-main --detach origin/main
 *   ln -s "$PWD/node_modules" /tmp/ff-main/node_modules
 *   cp test/pp7-draw-order-dom-matrix.ts test/pp7-draw-order-dom-golden.tsx /tmp/ff-main/test/
 *   cd /tmp/ff-main && DOM_GOLDEN_MAIN=1 \
 *     DOM_GOLDEN_OUT="$OLDPWD/test/fixtures/output-dom-main.golden.json" \
 *     npx tsx test/pp7-draw-order-dom-golden.tsx
 *
 * DOM_GOLDEN_MAIN=1 renders the way the ROUTES did — the compositor, then an
 * `<AnnouncementLayer>` painted as a sibling on top. Without it, the compositor
 * owns the announcement (this branch). DRAW_ORDER=0 sets the kill switch.
 */
import { writeFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { domMatrix, domKey } from "./pp7-draw-order-dom-matrix";

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

async function main() {
  if (process.env.DRAW_ORDER === "0") dom.window.localStorage.setItem("presentflow.pp7DrawOrder.v1", "0");
  const { OutputCompositor } = await import("../src/components/live/OutputCompositor");
  const MAIN = process.env.DOM_GOLDEN_MAIN === "1";
  const AnnouncementLayer = MAIN ? (await import("../src/components/live/AnnouncementLayer")).AnnouncementLayer : null;

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
      root.render(
        MAIN
          ? React.createElement(React.Fragment, null,
              React.createElement(OutputCompositor, props as never),
              React.createElement(AnnouncementLayer!, { ann: announcement }))
          : React.createElement(OutputCompositor, { ...props, announcement } as never),
      );
    });
    out[domKey(f)] = host.innerHTML;
    await act(async () => { root.unmount(); });
    host.remove();
  }
  writeFileSync(process.env.DOM_GOLDEN_OUT || "test/fixtures/output-dom-main.golden.json", JSON.stringify(out, null, 1) + "\n");
  console.log("dom fixtures:", Object.keys(out).length);
}

void main();
