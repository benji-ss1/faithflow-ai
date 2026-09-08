/**
 * output-compositor-frozen (Y3) — the operator mini-preview must freeze the
 * background layer (no 2nd live RAF WebGL loop / 2nd video decode) while the
 * projector (/live etc.) stays UNFROZEN and byte-identical.
 *
 * We render the shared OutputCompositor with a VIDEO Background Template: a live
 * background auto-plays (`autoplay` attr present); a frozen one does not. This
 * proves `previewFrozen` reaches BackgroundLayer, and that the default (the
 * projector path, which never passes the prop) stays live.
 *
 * Run: npx tsx test/output-compositor-frozen.test.ts
 */
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BackgroundSpec, SlidePayload } from "../src/lib/broadcast";

(globalThis as unknown as { React: typeof React }).React = React;

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}

async function main() {
  const { OutputCompositor } = await import("../src/components/live/OutputCompositor");
  const slide: SlidePayload = { kind: "text", text: "John 3:16" };
  const background: BackgroundSpec = { type: "video", videoUrl: "https://x/clip.mp4" } as BackgroundSpec;
  const html = (props: Record<string, unknown>) =>
    renderToStaticMarkup(React.createElement(OutputCompositor, { mode: "live", slide, background, ...props }));

  check("operator preview (previewFrozen) → background video is FROZEN (no autoplay)", () => {
    const out = html({ previewFrozen: true });
    assert.ok(out.includes("<video"), `expected a video background, got: ${out.slice(0, 200)}`);
    assert.ok(!out.includes("autoPlay"), `frozen preview must NOT autoPlay, got: ${out}`);
  });

  check("/live path (no previewFrozen prop) → background video stays LIVE (autoplay present)", () => {
    const out = html({});
    assert.ok(out.includes("<video"), `expected a video background, got: ${out.slice(0, 200)}`);
    assert.ok(out.includes("autoPlay"), `projector must autoplay the background, got: ${out}`);
  });

  check("/live path with explicit previewFrozen=false → still LIVE (autoplay present)", () => {
    const out = html({ previewFrozen: false });
    assert.ok(out.includes("autoPlay"), `explicit false must stay live, got: ${out}`);
  });

  console.log(`\nOutputCompositor frozen: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
