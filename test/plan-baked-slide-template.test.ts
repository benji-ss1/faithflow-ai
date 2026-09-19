/**
 * Regression lock (2026-09-19 owner report, "dragon-level"): a media image set as
 * the global BACKGROUND (Background Template) showed behind lyrics sent from the
 * Songs LIBRARY but projected plain BLACK once the same song was sent from a
 * PLAYLIST (plan) item.
 *
 * Root cause (reproduced in the browser, see the change note): library sends are
 * lyrics-only, but plan-item slides carry the song's saved objects_json. A song
 * that had a theme baked in keeps a slide-own near-black bgColor (the bake nudges a
 * black theme to #010101; #0b0b0b is the app's dark fallback) plus a text object.
 * SlideRenderer's DESIGNED-objects path let that colour beat the template
 * (slideBg > overVideo), painting an opaque box over it; the plain-lyric path
 * already let the template win. Fix: a words-only slide's own COLOUR yields to an
 * active template/camera; an explicit per-slide IMAGE, or any slide with a
 * non-text object (media frame, designed graphic), stays opaque.
 *
 * Run: npx tsx test/plan-baked-slide-template.test.ts
 */
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { themeConfigToAppearance } from "../src/lib/theme-appearance";
import type { SlidePayload } from "../src/lib/broadcast";

(globalThis as unknown as { React: typeof React }).React = React;

// Church default theme "hi": layout v3 with a lyrics text frame + an image decor object.
const HI = { align: "center", textColor: "#fff", fontFamily: "Inter", fontSizePx: 72, fontWeight: 600, layout: { version: 3, slides: [{ id: "theme_slide_lyrics", role: "lyrics", objects: [
  { id: "theme_main_text", kind: "text", role: "main", x: 80, y: 340, w: 1760, h: 400, text: "Lyrics appear here", fontFamily: "Inter", fontSize: 72, fontWeight: 600, color: "#ffffff", align: "center" },
  { id: "obj_img1", kind: "image", fit: "contain", x: 0, y: -60, w: 600, h: 400, url: "https://bucket.s3.amazonaws.com/decor.png?X-Amz-Expires=21600" },
] }] } };

const TEXT = (text: string) => ({ kind: "text" as const, text, x: 80, y: 340, w: 1760, h: 400, fontFamily: "Inter", fontSize: 72, fontWeight: 600, color: "#ffffff", align: "center" as const });
const BG = { type: "image" as const, imageUrl: "https://x.test/media-bg.jpg", imageFit: "fill" as const };

const LIBRARY: SlidePayload = { kind: "text", text: "Library lyric" };
const PLAN_BAKED_010101: SlidePayload = { kind: "text", text: "Plan lyric", bgColor: "#010101", objects: [TEXT("Plan lyric")] };
const PLAN_BAKED_0B0B0B: SlidePayload = { kind: "text", text: "Plan lyric", bgColor: "#0b0b0b", objects: [TEXT("Plan lyric")] };
const PLAN_BAKED_PLAIN: SlidePayload = { kind: "text", text: "Plan lyric", bgColor: "#010101" }; // no objects → plain path
const PLAN_TWO_TEXT: SlidePayload = { kind: "text", text: "Plan lyric", bgColor: "#010101", objects: [TEXT("Line A"), { ...TEXT("Line B"), y: 700 }] };
const PLAN_THEME_SCRIPTURE: SlidePayload = { kind: "text", text: "For God so loved", reference: "John 3:16", bgColor: "#010101", objects: [
  { ...TEXT("For God so loved"), role: "verse" as const },
  { ...TEXT("John 3:16"), y: 800, role: "reference" as const },
] };
const PLAN_WITH_IMAGE_OBJ: SlidePayload = { kind: "text", text: "x", bgColor: "#0b1220", objects: [
  { kind: "image", x: 600, y: 200, w: 700, h: 500, url: "https://x.test/logo.png", fit: "contain" },
] } as SlidePayload;
const PLAN_OWN_IMAGE: SlidePayload = { kind: "text", text: "Own image", bgColor: "#010101", bgImageUrl: "https://x.test/slide-own.jpg", objects: [TEXT("Own image")] };

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message.slice(0, 500)}`); fail++; }
}

async function main() {
  const { OutputCompositor } = await import("../src/components/live/OutputCompositor");
  const { SlideRenderer } = await import("../src/components/live/SlideRenderer");
  const appearance = themeConfigToAppearance(HI);
  assert.ok(appearance?.layout, "fixture must carry the hi theme layout");
  const render = (mode: "live" | "stage" | "livestream" | "ndi", slide: SlidePayload, layers: boolean, background: typeof BG | null = BG) =>
    renderToStaticMarkup(React.createElement(OutputCompositor, { mode, slide, appearance, background, layersEnabled: layers, layerOverrides: [], previewFrozen: layers, transition: null } as never));

  const MODES = ["live", "stage", "livestream", "ndi"] as const;
  const YIELDING: [string, SlidePayload][] = [
    ["baked #010101 + sole text object", PLAN_BAKED_010101],
    ["baked #0b0b0b + sole text object", PLAN_BAKED_0B0B0B],
    ["baked colour, no objects (plain path)", PLAN_BAKED_PLAIN],
    ["baked colour + two text objects", PLAN_TWO_TEXT],
    ["baked colour + theme scripture (verse/reference)", PLAN_THEME_SCRIPTURE],
  ];
  const OPAQUE = /background:#010101|background:#0b0b0b|background:#0b1220/;

  for (const mode of MODES) for (const layers of [false, true]) {
    check(`${mode} layers=${layers}: library (lyrics-only) shows the template, no opaque fill`, () => {
      const html = render(mode, LIBRARY, layers);
      assert.ok(html.includes('src="https://x.test/media-bg.jpg"'), "template missing");
      assert.ok(!OPAQUE.test(html));
    });
    for (const [label, slide] of YIELDING) {
      check(`${mode} layers=${layers}: PLAN ${label} shows the template behind the words`, () => {
        const html = render(mode, slide, layers);
        assert.ok(html.includes('src="https://x.test/media-bg.jpg"'), "template missing");
        assert.ok(!OPAQUE.test(html), "slide-own colour must not paint an opaque box over the template");
      });
    }
    check(`${mode} layers=${layers}: an explicit per-slide IMAGE still covers the template`, () => {
      const html = render(mode, PLAN_OWN_IMAGE, layers);
      assert.ok(html.includes("slide-own.jpg"), "slide's own image must render");
    });
    check(`${mode} layers=${layers}: a slide with a non-text object keeps its opaque colour over the template`, () => {
      const html = render(mode, PLAN_WITH_IMAGE_OBJ, layers);
      assert.ok(html.includes("background:#0b1220"), "media-frame / designed-graphic backstop must stay opaque");
    });
    check(`${mode} layers=${layers}: NO template active → the slide keeps its own baked colour (unchanged)`, () => {
      const html = render(mode, PLAN_BAKED_010101, layers, null);
      assert.ok(html.includes("background:#010101"), "without a template the baked colour still paints");
    });
  }

  // Pure SlideRenderer (operator card / monitor legacy branch) — same contract.
  const card = (slide: SlidePayload, overVideo: boolean) =>
    renderToStaticMarkup(React.createElement(SlideRenderer, { slide, appearance: appearance ?? undefined, overVideo } as never));
  for (const [label, slide] of YIELDING) {
    check(`SlideRenderer overVideo: ${label} is transparent (card/monitor == live)`, () => {
      assert.ok(!OPAQUE.test(card(slide, true)));
    });
    check(`SlideRenderer NOT overVideo: ${label} keeps its baked colour`, () => {
      const html = card(slide, false);
      if ("objects" in slide && slide.objects) assert.ok(/background:#010101|background:#0b0b0b/.test(html));
    });
  }
  check("SlideRenderer OBS transparent (transparentBg) unchanged: no fill at all", () => {
    const html = renderToStaticMarkup(React.createElement(SlideRenderer, { slide: PLAN_BAKED_010101, appearance: appearance ?? undefined, transparentBg: true } as never));
    assert.ok(!OPAQUE.test(html));
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
void main();
