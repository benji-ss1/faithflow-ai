/**
 * Regenerates `test/fixtures/output-dom-empty-main.golden.json` — the RENDERED
 * DOM of every fixture in `test/pp7-keep-theme-bg-dom-matrix.ts` as the output
 * compositor rendered it on `main` BEFORE "Clear Slide keeps the theme's media"
 * (2026-09-19). Not a test (no `.test.` in the name); it MAKES the evidence
 * `test/pp7-keep-theme-bg-dom.test.tsx` checks against.
 *
 *   git worktree add /tmp/ff-main --detach origin/main
 *   ln -s "$PWD/node_modules" /tmp/ff-main/node_modules
 *   cp test/pp7-keep-theme-bg-dom-matrix.ts test/pp7-keep-theme-bg-dom-golden.tsx /tmp/ff-main/test/
 *   cd /tmp/ff-main && DOM_GOLDEN_OUT="$OLDPWD/test/fixtures/output-dom-empty-main.golden.json" \
 *     npx tsx test/pp7-keep-theme-bg-dom-golden.tsx
 */
import { writeFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { emptyMatrix, emptyKey } from "./pp7-keep-theme-bg-dom-matrix";

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
  const { OutputCompositor } = await import("../src/components/live/OutputCompositor");
  const out: Record<string, string> = {};
  for (const f of emptyMatrix()) {
    const props: Record<string, unknown> = { ...f };
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
  writeFileSync(process.env.DOM_GOLDEN_OUT || "test/fixtures/output-dom-empty-main.golden.json", JSON.stringify(out, null, 1) + "\n");
  console.log("empty-slide dom fixtures:", Object.keys(out).length);
}

void main();
