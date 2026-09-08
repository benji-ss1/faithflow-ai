/**
 * slide-renderer-empty tests — golden regression for the BLACK-SCREEN class.
 *
 * A cleared (kind:"empty") slide sitting over an active Background Template must
 * render TRANSPARENT so the template shows through, NOT an opaque `bg-black` box.
 * This regressed only in the LAYERS_V2 compositor path: it wraps each layer in an
 * `absolute` opacity container, which flips the empty slide's paint order ABOVE
 * the absolute BackgroundLayer (in the legacy/preview path the empty slide is
 * `position:static`, so the absolute template paints on top of it). The
 * plan-level parity fixtures never caught it because it is a CSS paint-order /
 * DOM effect, not a plan difference — so this test asserts the actual DOM class.
 *
 * Run: npx tsx test/slide-renderer-empty.test.ts
 */
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SlidePayload } from "../src/lib/broadcast";

// SlideRenderer.tsx is compiled with the classic JSX transform (tsconfig
// jsx:"preserve"), which references a global `React`. Provide it before the
// dynamic import so the component's createElement calls resolve.
(globalThis as unknown as { React: typeof React }).React = React;

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}

async function main() {
  const { SlideRenderer } = await import("../src/components/live/SlideRenderer");
  const empty: SlidePayload = { kind: "empty" };
  const html = (props: Record<string, unknown>) =>
    renderToStaticMarkup(React.createElement(SlideRenderer, { slide: empty, ...props }));

  // ---- over a Background Template (overVideo) → transparent, template shows ----
  check("empty slide with overVideo renders transparent (no bg-black) — template shows through", () => {
    const out = html({ overVideo: true });
    assert.ok(!out.includes("bg-black"), `expected no bg-black, got: ${out}`);
  });

  // ---- OBS/NDI alpha key (transparentBg) → transparent, unchanged behaviour ----
  check("empty slide with transparentBg renders transparent (no bg-black)", () => {
    const out = html({ transparentBg: true });
    assert.ok(!out.includes("bg-black"), `expected no bg-black, got: ${out}`);
  });

  // ---- nothing behind (no template, not transparent) → opaque black (correct) --
  check("empty slide with NO template stays opaque bg-black (cleared → black projector)", () => {
    const out = html({});
    assert.ok(out.includes("bg-black"), `expected bg-black, got: ${out}`);
  });

  console.log(`\nSlideRenderer empty: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
