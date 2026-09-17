/**
 * Regression lock (2026-09-17 prod report): an active Background Template
 * (e.g. a Media Bin image set as background) must stay visible BEHIND the
 * words on the live output when the church default theme carries a saved
 * layout with decor (theme "hi": unchanged seed box + an image object whose
 * presigned URL may have expired). Verified identical to pre-#52 (7afca1e).
 *
 * Run: npx tsx test/live-bg-theme-decor.test.ts
 */
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { themeConfigToAppearance } from "../src/lib/theme-appearance";
import type { SlidePayload } from "../src/lib/broadcast";

(globalThis as unknown as { React: typeof React }).React = React;

const CFG = { align: "center", textColor: "#fff", fontFamily: "Inter", fontSizePx: 72, fontWeight: 600, layout: { version: 3, slides: [{ id: "theme_slide_lyrics", role: "lyrics", objects: [
  { id: "theme_main_text", kind: "text", x: 80, y: 340, w: 1760, h: 400, text: "Lyrics appear here", fontFamily: "Inter", fontSize: 72, fontWeight: 600, color: "#ffffff", align: "center", role: "main" },
  { id: "obj_img1", kind: "image", fit: "contain", x: 0, y: -60, w: 600, h: 400, url: "https://bucket.s3.amazonaws.com/decor.png?X-Amz-Expires=21600" },
] }] } };
// A moved text box (non-seed) → the framed-text branch.
const CFG_FRAMED = JSON.parse(JSON.stringify(CFG));
CFG_FRAMED.layout.slides[0].objects[0].id = "custom_box";
CFG_FRAMED.layout.slides[0].objects[0].y = 600;

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message.slice(0, 400)}`); fail++; }
}

async function main() {
  const { OutputCompositor } = await import("../src/components/live/OutputCompositor");
  const LYRIC: SlidePayload = { kind: "text", text: "Gods not dead" };
  const BG = { type: "image" as const, imageUrl: "https://x.test/crown.jpg", imageFit: "fill" as const };
  for (const [label, cfg] of [["seed box + decor", CFG], ["framed box + decor", CFG_FRAMED]] as const) {
    const appearance = themeConfigToAppearance(cfg);
    for (const layersEnabled of [false, true]) {
      check(`${label}, layers=${layersEnabled}: background image rendered, slide root transparent`, () => {
        assert.ok(appearance?.layout, "fixture must carry a theme layout");
        const html = renderToStaticMarkup(React.createElement(OutputCompositor, { mode: "live", slide: LYRIC, appearance, background: BG, layersEnabled, layerOverrides: [], previewFrozen: layersEnabled, transition: null } as never));
        assert.ok(html.includes('src="https://x.test/crown.jpg"'), "background layer missing");
        assert.ok(html.indexOf("crown.jpg\"") < html.indexOf("Gods not dead"), "background must paint before (behind) the words");
        assert.ok(html.includes('style="background:transparent"'), "slide root must be transparent over the background");
        assert.ok(!/background:#0b0b0b|background:#000000|background-color:#000/.test(html), "no opaque root fill may cover the background");
      });
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
void main();
