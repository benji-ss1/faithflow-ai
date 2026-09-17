/**
 * Theme → Projector (PR 2) — layout mapping, wire validation and rendering.
 *
 * Proves: (1) existing inputs render BYTE-IDENTICALLY to the pre-PR-2 baseline
 * (test/fixtures/theme-pr2-baseline.json, generated on main before any change);
 * (2) a theme text box reaches /live, livestream (non-transparent) and the
 * single-text song path; (3) stage, OBS transparent, camera band/top, lower-third
 * and designed multi-object slides ignore it; (4) the mapper ignores the untouched
 * seed box and its output always passes the strict wire validator; (5) hostile
 * layouts are rejected; (6) slideOutputIdentity never depends on appearance.
 *
 * Run: npx tsx test/theme-projector-layout.test.ts
 */
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  isValidThemeAppearance, isValidThemeLayoutWire, isValidOutputState, sanitizeOutputState, slideOutputIdentity,
  EMPTY_OUTPUT, THEME_LAYOUT_WIRE_MAX_BYTES, type ThemeAppearance, type SlidePayload,
} from "../src/lib/broadcast";
import { themeConfigToAppearance, themeLayoutFromConfig } from "../src/lib/theme-appearance";
import { renderMatrix, renderCompositorMatrix, scriptureMatrix, SLIDES } from "./theme-pr2-fixtures";
import baseline from "./fixtures/theme-pr2-baseline.json";

(globalThis as unknown as { React: typeof React }).React = React;

let pass = 0, fail = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message.slice(0, 400)}`); fail++; }
}

const FRAME = { x: 200, y: 600, w: 1500, h: 380, fontFamily: "Inter, sans-serif", fontSize: 90, color: "#ffcc00", align: "left" as const };
const LAYOUT = { lyrics: { main: FRAME }, scripture: { verse: { x: 100, y: 100, w: 1700, h: 700 }, reference: { x: 100, y: 850, w: 1700, h: 120, fontSize: 40 } } };
const withLayout = (a: ThemeAppearance | null): ThemeAppearance => ({ ...(a ?? {}), layout: LAYOUT });

function cfgWithSlides(slides: unknown[]) { return { layout: { version: 3, slides } }; }
const text = (o: Record<string, unknown>) => ({ kind: "text", text: "x", ...o });

async function main() {
  const { SlideRenderer } = await import("../src/components/live/SlideRenderer");
  const { OutputCompositor } = await import("../src/components/live/OutputCompositor");
  const r = (slide: SlidePayload, props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(SlideRenderer, { slide, ...props }));

  console.log("No-regression parity vs pre-PR-2 baseline:");
  const base = baseline as { renderer: Record<string, string>; compositor: Record<string, string>; scripture: unknown };
  await check(`SlideRenderer: ${Object.keys(base.renderer).length} fixtures byte-identical`, async () => {
    const now = await renderMatrix();
    for (const k of Object.keys(base.renderer)) assert.equal(now[k], base.renderer[k], k);
  });
  await check(`OutputCompositor live/stage/livestream(+transparent): ${Object.keys(base.compositor).length} fixtures byte-identical`, async () => {
    const now = await renderCompositorMatrix();
    for (const k of Object.keys(base.compositor)) assert.equal(now[k], base.compositor[k], k);
  });
  await check("applyChurchLayout (no theme opts): styled payloads + identities byte-identical", async () => {
    assert.deepEqual(await scriptureMatrix(), base.scripture);
  });

  console.log("Gated surfaces ignore theme boxes (render == baseline without layout):");
  await check("stage compositor with a layout-bearing appearance == baseline", async () => {
    const now = await renderCompositorMatrix(withLayout);
    for (const k of Object.keys(base.compositor)) {
      if (k.startsWith("stage/") || k.startsWith("livestream-transparent/")) assert.equal(now[k], base.compositor[k], k);
      if (k.startsWith("stage/")) assert.ok(!now[k].includes("data-theme-frame"), k);
    }
  });
  await check("transparent / camera band / lyrics-moved-over-camera / lower-third / designed / ignoreThemeLayout → no frame", async () => {
    const now = await renderMatrix(withLayout);
    const nowIgnored = await renderMatrix(withLayout, { ignoreThemeLayout: true });
    for (const k of Object.keys(now)) {
      const [sk, , pk] = k.split("/");
      if (pk === "transparent" || pk === "band" || pk === "overVideoTop" || sk === "lowerThird" || sk === "designed" || sk === "blank" || sk === "empty") {
        assert.ok(!now[k].includes("data-theme-frame"), `${k} must not use a theme frame`);
      }
      assert.ok(!nowIgnored[k].includes("data-theme-frame"), `${k} ignoreThemeLayout`);
    }
  });
  await check("ignoreThemeLayout render == render without layout (stage stays full-screen, byte-identical)", async () => {
    const ign = await renderMatrix(withLayout, { ignoreThemeLayout: true });
    const plain = await renderMatrix();
    for (const k of Object.keys(plain)) assert.equal(ign[k], plain[k], k);
  });

  console.log("Theme boxes reach the projector:");
  await check("plain lyric slide → framed %-box with theme style", () => {
    const html = r(SLIDES.lyric, { projectorFit: true, appearance: { layout: LAYOUT } });
    assert.ok(html.includes("data-theme-frame"), html.slice(0, 300));
    assert.ok(html.includes(`left:${(200 / 1920) * 100}%`), "left %");
    assert.ok(html.includes(`width:${(1500 / 1920) * 100}%`), "width %");
    assert.ok(html.includes("color:#ffcc00"), "frame colour");
  });
  await check("single-text song object (decision 1) → lyrics box", () => {
    const html = r(SLIDES.soleText, { projectorFit: true, appearance: { layout: LAYOUT } });
    assert.ok(html.includes("data-theme-frame"));
  });
  await check("plain scripture → verse box + reference box (reference text kept)", () => {
    const html = r(SLIDES.scripturePlain, { projectorFit: true, appearance: { layout: LAYOUT }, referenceColor: "#00ff00" });
    assert.equal(html.split("data-theme-frame").length - 1, 2);
    assert.ok(html.includes("John 3:16 (KJV)"));
    assert.ok(html.includes("color:#00ff00"), "referenceColor still wins");
  });
  await check("scripture with no reference box → reference inside the verse box", () => {
    const html = r(SLIDES.scripturePlain, { projectorFit: true, appearance: { layout: { scripture: { verse: { x: 0, y: 0, w: 1000, h: 500 } } } } });
    assert.equal(html.split("data-theme-frame").length - 1, 2);
    assert.ok(html.includes(`top:${(400 / 1080) * 100}%`), "ref box at 80% of verse box");
  });
  await check("lyric frame ignored for a scripture slide with only a lyrics box (legacy footer render)", () => {
    const html = r(SLIDES.scripturePlain, { projectorFit: true, appearance: { layout: { lyrics: { main: FRAME } } } });
    assert.equal(html, base.renderer["scripturePlain/none/projector"]);
  });
  await check("theme video bg (overVideo centre) still uses the box; fontScale variants keep the frame", () => {
    for (const fontScale of [0.5, 1, 1.8]) {
      const html = r(SLIDES.lyric, { projectorFit: true, overVideo: true, fontScale, appearance: { layout: LAYOUT } });
      assert.ok(html.includes("data-theme-frame"), `fontScale ${fontScale}`);
    }
  });
  await check("live + livestream (opaque) compositor use the box; livestream transparent does not", () => {
    const h = (props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(OutputCompositor, { slide: SLIDES.lyric, appearance: { layout: LAYOUT }, ...props } as never));
    assert.ok(h({ mode: "live" }).includes("data-theme-frame"));
    assert.ok(h({ mode: "livestream" }).includes("data-theme-frame"));
    assert.ok(!h({ mode: "livestream", transparent: true }).includes("data-theme-frame"));
    assert.ok(!h({ mode: "stage" }).includes("data-theme-frame"));
  });
  await check("identity never depends on appearance/layout (no remount / no fade-pulse)", () => {
    for (const s of Object.values(SLIDES)) assert.equal(slideOutputIdentity(s), slideOutputIdentity(JSON.parse(JSON.stringify(s))));
    // slideOutputIdentity takes only the slide — assert its signature stays 1-arg.
    assert.equal(slideOutputIdentity.length, 1);
  });

  console.log("Mapper (themeConfigToAppearance / themeLayoutFromConfig):");
  await check("no layout → identical to before (no layout key)", () => {
    const a = themeConfigToAppearance({ textColor: "#ffffff", fontFamily: "Inter" });
    assert.ok(a && !("layout" in a));
    assert.equal(themeConfigToAppearance({}), null);
  });
  await check("untouched seed box is NOT a frame (theme with only the seed → null appearance)", () => {
    const seed = text({ id: "theme_main_text", x: 80, y: 340, w: 1760, h: 400, role: "main", fontFamily: "Inter" });
    assert.equal(themeLayoutFromConfig(cfgWithSlides([{ id: "theme_slide_lyrics", name: "Lyrics", role: "lyrics", objects: [seed] }])), undefined);
    assert.equal(themeConfigToAppearance(cfgWithSlides([{ id: "s", name: "L", role: "lyrics", objects: [seed] }])), null);
  });
  await check("moved seed box → lyrics frame; counts as meaningful", () => {
    const moved = text({ id: "theme_main_text", x: 80, y: 600, w: 1760, h: 400, role: "main", fontSize: 80, color: "#ff0000", align: "left", uppercase: false });
    const a = themeConfigToAppearance(cfgWithSlides([{ id: "s", name: "L", role: "lyrics", objects: [moved] }]));
    assert.deepEqual(a?.layout, { lyrics: { main: { x: 80, y: 600, w: 1760, h: 400, fontSize: 80, color: "#ff0000", align: "left", uppercase: false } } });
  });
  await check("scripture slide verse + reference roles → scripture frames", () => {
    const l = themeLayoutFromConfig(cfgWithSlides([{ id: "sc", name: "S", role: "scripture", objects: [
      text({ id: "v", x: 100, y: 100, w: 1700, h: 600, role: "verse", fontFamily: "Georgia" }),
      text({ id: "r", x: 100, y: 800, w: 1700, h: 100, role: "reference" }),
    ] }]));
    assert.deepEqual(l, { scripture: { verse: { x: 100, y: 100, w: 1700, h: 600, fontFamily: "Georgia, serif" }, reference: { x: 100, y: 800, w: 1700, h: 100 } } });
  });
  await check("hidden / tiny / NaN boxes are skipped", () => {
    assert.equal(themeLayoutFromConfig(cfgWithSlides([{ id: "s", role: "lyrics", objects: [text({ id: "a", x: 1, y: 1, w: 30, h: 400 })] }])), undefined);
    assert.equal(themeLayoutFromConfig(cfgWithSlides([{ id: "s", role: "lyrics", objects: [text({ id: "a", x: 1, y: 1, w: 300, h: 400, hidden: true })] }])), undefined);
    assert.equal(themeLayoutFromConfig(cfgWithSlides([{ id: "s", role: "lyrics", objects: [text({ id: "a", x: NaN, y: 1, w: 300, h: 400 })] }])), undefined);
    assert.equal(themeLayoutFromConfig({ layout: { version: 2, slides: [] } }), undefined);
  });
  await check("fuzz: mapper output ALWAYS passes the wire validator (500 random configs)", () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
    const nums = [NaN, Infinity, -5000, -10, 0, 39, 40, 100, 999, 1920, 5000, 1e9];
    for (let i = 0; i < 500; i++) {
      const obj = text({
        id: "o" + i, x: pick(nums), y: pick(nums), w: pick(nums), h: pick(nums),
        role: pick(["main", "verse", "reference", undefined, "evil"]),
        fontFamily: pick(["Inter", "x".repeat(119), "bad;font{}", undefined, 7]),
        fontSize: pick(nums), fontWeight: pick(nums), color: pick(["#fff", "red", "rgba(1,2,3,0.5)", "url(x)", undefined]),
        align: pick(["left", "middle", undefined]), italic: pick([true, "yes", undefined]), uppercase: pick([false, 1, undefined]), shadow: pick([true, null, undefined]),
      });
      const cfg = cfgWithSlides([{ id: "s", role: pick(["lyrics", "scripture", undefined]), objects: [obj, { ...obj, id: "p" + i, role: pick(["verse", "reference"]) }] }]);
      const a = themeConfigToAppearance(cfg);
      if (a) assert.ok(isValidThemeAppearance(a), JSON.stringify(a));
    }
  });

  console.log("Wire validator (hostile layouts rejected):");
  const good: ThemeAppearance = { layout: LAYOUT };
  await check("valid layout accepted in appearance + OutputState", () => {
    assert.ok(isValidThemeAppearance(good));
    assert.ok(isValidOutputState({ ...EMPTY_OUTPUT, appearance: good }));
  });
  const hostile: [string, unknown][] = [
    ["unknown top key", { lyrics: { main: FRAME }, evil: 1 }],
    ["unknown frame key", { lyrics: { main: { ...FRAME, onclick: "x" } } }],
    ["unknown group key", { lyrics: { main: FRAME, extra: FRAME } }],
    ["__proto__ pollution", JSON.parse('{"lyrics":{"main":{"x":1,"y":1,"w":100,"h":100,"__proto__":{"a":1}}}}')],
    ["NaN coord", { lyrics: { main: { ...FRAME, x: NaN } } }],
    ["w below 40", { lyrics: { main: { ...FRAME, w: 39 } } }],
    ["huge h", { lyrics: { main: { ...FRAME, h: 99999 } } }],
    ["font injection", { lyrics: { main: { ...FRAME, fontFamily: "x;}body{display:none" } } }],
    ["bad colour", { lyrics: { main: { ...FRAME, color: "url(javascript:x)" } } }],
    ["bad align", { lyrics: { main: { ...FRAME, align: "justify" } } }],
    ["string boolean", { lyrics: { main: { ...FRAME, italic: "true" } } }],
    ["array", []],
    ["frame is array", { lyrics: { main: [1, 2] } }],
  ];
  for (const [name, layout] of hostile) {
    await check(`rejects: ${name}`, () => {
      assert.equal(isValidThemeLayoutWire(layout), false);
      assert.equal(isValidThemeAppearance({ textColor: "#fff", layout }), false);
      const s = sanitizeOutputState({ ...EMPTY_OUTPUT, live: { kind: "text", text: "hi" }, appearance: { textColor: "#fff", layout } });
      assert.ok(s && s.appearance === null, "sanitizer nulls a bad appearance; live slide still projects");
      assert.equal((s!.live as { text?: string }).text, "hi");
    });
  }
  await check("byte cap: the largest legal layout fits under THEME_LAYOUT_WIRE_MAX_BYTES", () => {
    const f = { ...FRAME, fontFamily: "a".repeat(120) };
    assert.equal(isValidThemeLayoutWire({ lyrics: { main: f }, scripture: { verse: f, reference: f } }), true);
    // Known keys only → the largest legal layout still fits under the cap.
    assert.ok(JSON.stringify({ lyrics: { main: f }, scripture: { verse: f, reference: f } }).length < THEME_LAYOUT_WIRE_MAX_BYTES);
  });

  console.log(`\ntheme-projector-layout: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
main();
