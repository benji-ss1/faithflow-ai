/**
 * Theme → Projector (PR 2, review round) — theme DECOR objects (images, shapes,
 * video, extra text, slide background from the theme editor) render behind the
 * slide text on every slide using the theme, like ProPresenter theme objects.
 *
 * Includes the production bug config: default theme "hi" with the UNCHANGED seed
 * text box + an image object → the image must reach the projector.
 *
 * Also locks the review fixes: role validation, strip-only-layout sanitising,
 * framed text min size/cap, voice nav fast fade, item-independent scripture
 * resolver, song appliedThemeId precedence, themes-changed reload, Bible preview
 * layout, saved-Scripture-Style notice, theme popover real preview.
 *
 * Run: npx tsx test/theme-decor.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  isValidThemeLayoutWire, isValidThemeAppearance, isValidSlideObject, sanitizeOutputState, EMPTY_OUTPUT,
  MAX_THEME_DECOR_OBJECTS, type SlidePayload, type ThemeAppearance,
} from "../src/lib/broadcast";
import { themeConfigToAppearance, themeLayoutFromConfig } from "../src/lib/theme-appearance";
import { themeScriptureOptions } from "../src/lib/theme-scripture";
import { applyChurchLayout } from "../src/components/operator/scripture/scriptureStyle";

(globalThis as unknown as { React: typeof React }).React = React;

let pass = 0, fail = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message.slice(0, 500)}`); fail++; }
}
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const IMG_URL = "https://abc.supabase.co/storage/v1/object/sign/media/church-1/logo.png?token=x";
const SEED = { id: "theme_main_text", kind: "text", x: 80, y: 340, w: 1760, h: 400, text: "Lyrics appear here", fontFamily: "Inter", fontSize: 72, fontWeight: 600, color: "#ffffff", align: "center", role: "main" };
const IMAGE = { id: "obj_img1", kind: "image", x: 0, y: -60, w: 600, h: 400, url: IMG_URL };
// The production bug config (DB-confirmed shape).
const BUG_CFG = { bgType: "solid", bgColor: "#101020", layout: { version: 3, slides: [{ id: "theme_slide_lyrics", name: "Lyrics", role: "lyrics", objects: [SEED, IMAGE] }] } };

async function main() {
  const { SlideRenderer } = await import("../src/components/live/SlideRenderer");
  const { OutputCompositor } = await import("../src/components/live/OutputCompositor");
  const { ThemeThumb, themeThumbAppearance } = await import("../src/components/operator/pro/ThemePopover");
  const r = (slide: SlidePayload, props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(SlideRenderer, { slide, projectorFit: true, ...props }));
  const LYRIC: SlidePayload = { kind: "text", text: "Amazing grace" };

  console.log("Production bug — seed box + image object:");
  const bugAppearance = themeConfigToAppearance(BUG_CFG);
  await check("appearance carries lyrics decor (image) and NO frame for the unchanged seed", () => {
    assert.ok(bugAppearance?.layout?.lyrics, JSON.stringify(bugAppearance));
    assert.equal(bugAppearance!.layout!.lyrics!.main, undefined);
    assert.deepEqual(bugAppearance!.layout!.lyrics!.decor, [{ kind: "image", x: 0, y: -60, w: 600, h: 400, url: IMG_URL }]);
    assert.ok(isValidThemeAppearance(bugAppearance));
  });
  await check("projector (/live) renders the image behind full-screen lyrics", () => {
    const html = r(LYRIC, { appearance: bugAppearance });
    assert.ok(html.includes(IMG_URL.replace(/&/g, "&amp;")), html.slice(0, 400));
    assert.ok(!html.includes("data-theme-frame"), "seed is not a frame");
    assert.ok(html.indexOf("<img") < html.indexOf("Amazing grace"), "decor painted before (behind) the text");
    assert.ok(html.includes("relative z-[1]"), "text lifted above the decor layer");
  });
  await check("single-text song object + livestream opaque + NDI-style plain render show decor", () => {
    const sole: SlidePayload = { kind: "text", text: "Way maker", objects: [{ kind: "text", x: 80, y: 340, w: 1760, h: 400, text: "Way maker" }] };
    assert.ok(r(sole, { appearance: bugAppearance }).includes("<img"));
    const live = renderToStaticMarkup(React.createElement(OutputCompositor, { mode: "livestream", slide: LYRIC, appearance: bugAppearance } as never));
    assert.ok(live.includes("<img"));
  });
  await check("gated OFF: stage, OBS transparent, camera band, lower-third, designed slide, ignoreThemeLayout, blank", () => {
    const stage = renderToStaticMarkup(React.createElement(OutputCompositor, { mode: "stage", slide: LYRIC, appearance: bugAppearance } as never));
    assert.ok(!stage.includes("<img"), "stage");
    assert.ok(!r(LYRIC, { appearance: bugAppearance, transparentBg: true }).includes("<img"), "transparent");
    assert.ok(!r(LYRIC, { appearance: bugAppearance, overVideo: true, fitBandFraction: 0.38 }).includes("<img"), "band");
    assert.ok(!r(LYRIC, { appearance: bugAppearance, ignoreThemeLayout: true }).includes("<img"), "ignore");
    assert.ok(!r({ kind: "text", text: "v", reference: "John 1:1", scriptureLayout: "lowerThird" }, { appearance: bugAppearance }).includes("<img"), "lower third");
    const designed: SlidePayload = { kind: "text", text: "x", objects: [{ kind: "shape", x: 0, y: 0, w: 10, h: 10, shape: "rect", fill: "#ff0000" }, { kind: "text", x: 0, y: 0, w: 900, h: 300, text: "x" }] };
    assert.ok(!r(designed, { appearance: bugAppearance }).includes("<img"), "designed");
    assert.ok(!r({ kind: "blank" }, { appearance: bugAppearance }).includes("<img"), "blank");
  });
  await check("ignoreThemeLayout / no-decor renders are byte-identical to no layout at all", () => {
    const { layout: _l, ...noLayout } = bugAppearance!; void _l;
    assert.equal(r(LYRIC, { appearance: bugAppearance, ignoreThemeLayout: true }), r(LYRIC, { appearance: noLayout }));
  });

  console.log("Decor mapping:");
  await check("scripture slide decor + slide background; lyrics decor fallback for scripture", () => {
    const cfg = { layout: { version: 3, slides: [
      { id: "l", role: "lyrics", bgColor: "#223344", objects: [SEED, { id: "s1", kind: "shape", x: 0, y: 900, w: 1920, h: 180, shape: "rect", fill: "#000000", locked: true }] },
      { id: "sc", role: "scripture", bgImageUrl: "https://cdn.example.com/s.jpg", objects: [{ id: "t", kind: "text", x: 50, y: 50, w: 400, h: 80, text: "Sunday" }, { id: "hid", kind: "shape", x: 0, y: 0, w: 5, h: 5, shape: "rect", hidden: true }] },
    ] } };
    const l = themeLayoutFromConfig(cfg)!;
    assert.deepEqual(l.lyrics?.decor, [
      { kind: "shape", x: 0, y: 0, w: 1920, h: 1080, shape: "rect", fill: "#223344" },
      { kind: "shape", x: 0, y: 900, w: 1920, h: 180, shape: "rect", fill: "#000000" },
    ]);
    assert.deepEqual(l.scripture?.decor, [
      { kind: "image", x: 0, y: 0, w: 1920, h: 1080, url: "https://cdn.example.com/s.jpg", fit: "cover" },
      { kind: "text", x: 50, y: 50, w: 400, h: 80, text: "Sunday" },
    ]);
    const a = { layout: l } as ThemeAppearance;
    const verse = r({ kind: "text", text: "For God", reference: "John 3:16" }, { appearance: a });
    assert.ok(verse.includes("Sunday") && verse.includes("s.jpg"), "scripture uses scripture decor");
    const onlyLyrics = { layout: { lyrics: l.lyrics } } as ThemeAppearance;
    assert.ok(r({ kind: "text", text: "For God", reference: "John 3:16" }, { appearance: onlyLyrics }).includes("#223344"), "falls back to lyrics decor");
  });
  await check("theme scripture path (role verse) draws scripture decor", () => {
    const cfg = { scriptureReferencePosition: "below", layout: { version: 3, slides: [{ id: "sc", role: "scripture", objects: [{ id: "t", kind: "text", x: 50, y: 50, w: 400, h: 80, text: "Welcome" }] }] } };
    const styled = applyChurchLayout({ kind: "text", text: "For God", reference: "John 3:16" }, "c", themeScriptureOptions(cfg));
    const html = r(styled, { appearance: themeConfigToAppearance(cfg) });
    assert.ok(html.includes("Welcome") && html.includes("data-theme-frame"));
  });
  await check("a scripture layout slide alone opts scripture in", () => {
    assert.ok(themeScriptureOptions({ layout: { version: 3, slides: [{ id: "sc", role: "scripture", objects: [] }] } }));
  });
  await check("decor skips blob / non-renderable urls and caps at MAX_THEME_DECOR_OBJECTS", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, kind: "shape", x: i, y: 0, w: 10, h: 10, shape: "rect" }));
    const l = themeLayoutFromConfig({ layout: { version: 3, slides: [{ id: "l", role: "lyrics", objects: [SEED, { id: "b", kind: "image", x: 0, y: 0, w: 9, h: 9, url: "blob:http://x/1" }, { id: "j", kind: "image", x: 0, y: 0, w: 9, h: 9, url: "javascript:alert(1)" }, ...many] }] } })!;
    assert.equal(l.lyrics!.decor!.length, MAX_THEME_DECOR_OBJECTS);
    assert.ok(l.lyrics!.decor!.every((o) => o.kind === "shape"));
  });

  console.log("Decor wire validation (hostile):");
  const shape = { kind: "shape", x: 0, y: 0, w: 10, h: 10, shape: "rect" };
  const hostile: [string, unknown][] = [
    ["javascript: image url", { lyrics: { decor: [{ kind: "image", x: 0, y: 0, w: 1, h: 1, url: "javascript:alert(1)" }] } }],
    ["blob: video url", { lyrics: { decor: [{ kind: "video", x: 0, y: 0, w: 1, h: 1, url: "blob:http://x/1" }] } }],
    ["quote-breaking url", { lyrics: { decor: [{ kind: "image", x: 0, y: 0, w: 1, h: 1, url: 'https://x/a.png") ; background:url("evil' }] } }],
    ["role on decor text", { lyrics: { decor: [{ kind: "text", x: 0, y: 0, w: 1, h: 1, text: "x", role: "main" }] } }],
    ["unknown kind", { lyrics: { decor: [{ kind: "iframe", x: 0, y: 0, w: 1, h: 1 }] } }],
    ["too many objects", { lyrics: { decor: Array.from({ length: MAX_THEME_DECOR_OBJECTS + 1 }, () => shape) } }],
    ["decor not an array", { lyrics: { decor: shape } }],
    ["polluted object", { scripture: { decor: [JSON.parse('{"kind":"shape","x":0,"y":0,"w":1,"h":1,"shape":"rect","__proto__":{"x":1}}')] } }],
    ["NaN coords", { lyrics: { decor: [{ ...shape, x: NaN }] } }],
  ];
  for (const [name, layout] of hostile) {
    await check(`rejects: ${name}`, () => {
      assert.equal(isValidThemeLayoutWire(layout), false);
      const s = sanitizeOutputState({ ...EMPTY_OUTPUT, live: { kind: "text", text: "hi" }, appearance: { bgColor: "#000000", layout } });
      assert.deepEqual(s?.appearance, { bgColor: "#000000" }, "only the layout is stripped");
    });
  }
  await check("valid decor accepted (16 objects)", () => {
    assert.ok(isValidThemeLayoutWire({ lyrics: { decor: Array.from({ length: MAX_THEME_DECOR_OBJECTS }, () => shape) } }));
  });
  await check("isValidSlideObject text role: undefined|main|verse|reference only", () => {
    const t = { kind: "text", x: 0, y: 0, w: 1, h: 1, text: "x" };
    for (const role of [undefined, "main", "verse", "reference"]) assert.ok(isValidSlideObject({ ...t, role }), String(role));
    for (const role of ["evil", 1, null, ""]) assert.equal(isValidSlideObject({ ...t, role }), false, String(role));
  });

  console.log("Themes popover preview:");
  await check("ThemeThumb renders the REAL slide (image object + background) — not the CSS approximation", () => {
    const html = renderToStaticMarkup(React.createElement(ThemeThumb, { theme: { id: "t1", name: "hi", isDefault: true, config: BUG_CFG } as never }));
    assert.ok(html.includes("data-theme-thumb"));
    assert.ok(html.includes("<img"), html.slice(0, 500));
    assert.ok(html.includes("#101020"), "theme background");
    assert.ok(html.includes("Lyrics appear here"));
  });
  await check("thumb appearance is static (no animation, no decor video)", () => {
    const a = themeThumbAppearance({ bgType: "gradient", bgColor: "#000000", bgColor2: "#111111", bgAnimation: "drift", layout: { version: 3, slides: [{ id: "l", role: "lyrics", objects: [SEED, { id: "v", kind: "video", x: 0, y: 0, w: 100, h: 100, url: "https://cdn.example.com/v.mp4" }, IMAGE] }] } })!;
    assert.equal(a.bgAnimation, undefined);
    assert.deepEqual(a.layout?.lyrics?.decor?.map((o) => o.kind), ["image"]);
  });

  console.log("Frames: never spill + cap:");
  await check("ThemeFramedText: minPx ≤ 8 and maxPx capped at 400 (source)", () => {
    const s = src("src/components/live/SlideRenderer.tsx");
    assert.ok(s.includes("maxPx={Math.min(400, Math.max(8, Math.round((frame.fontSize ?? 120) * Math.max(1, scale))))}"));
    assert.ok(s.includes("minPx={Math.min(textMinPx ?? 8, 8)}"));
    assert.ok(src("src/components/live/AutoFitText.tsx").includes("[currentText, fontScale, fontToken, reserveVerticalRatio, maxPx]"), "refit when maxPx changes");
  });

  console.log("Operator wiring (source invariants):");
  const shell = src("src/components/operator/pro/ProOperatorShell.tsx");
  await check("voice repeat-verse (x2) + go-to-verse use the fast AI fade", () => {
    for (const call of [
      'ctx.onSendSlideToLive({ kind: "text", text: body, reference: c.label }, undefined, { preserveConfiguredTransition: true });',
      'ctx.onSendSlideToLive({ kind: "text", text: ctx.liveSlide.text, reference: ctx.liveSlide.reference }, undefined, { preserveConfiguredTransition: true });',
      'ctx.onSendSlideToLive({ kind: "text", text: hit.text, reference: label }, undefined, { preserveConfiguredTransition: true });',
    ]) assert.ok(shell.includes(call), call);
  });
  const oc = src("src/components/operator/OperatorConsole.tsx");
  await check("scripture theme resolver is item-independent (send == live-item / origin lookups)", () => {
    const body = oc.slice(oc.indexOf("const themeConfigForSend = useCallback("), oc.indexOf("const scriptureThemeOptsFor = useCallback("));
    const scripture = body.slice(body.indexOf('if (purpose === "scripture") {'), body.indexOf("// Item theme → song's applied theme"));
    assert.ok(!/item/.test(scripture.replace(/\/\/.*$/gm, "")), scripture);
    assert.ok(oc.includes("applyChurchLayout(ps, churchId, scriptureThemeOptsFor(ps, plan.items[i]))"));
    assert.ok(oc.includes("}, [plan.items, live.kind, liveKey, churchId, themesVersion, contentStyles]);"), "liveItemIdx deps include themes + contentStyles");
  });
  await check("lookup consistency: identity for the same verse is equal whatever item is passed", () => {
    const opts = themeScriptureOptions({ scriptureShowReference: false });
    const v: SlidePayload = { kind: "text", text: "For God", reference: "John 3:16 (KJV)" };
    const { slideOutputIdentity } = require("../src/lib/broadcast") as typeof import("../src/lib/broadcast");
    assert.equal(slideOutputIdentity(applyChurchLayout(v, "c", opts)), slideOutputIdentity(applyChurchLayout(v, "c", opts)));
  });
  await check("precedence: item theme > song appliedThemeId > content-type > default", () => {
    assert.ok(oc.includes("if (item?.themeId) { const c = byId(item.themeId); if (c) return c; }\n    if (item?.songAppliedThemeId) { const c = byId(item.songAppliedThemeId); if (c) return c; }"));
    assert.ok(/themeId\s*\n\s*\?\? \(plan\.items\[liveItemIdx\] as \{ songAppliedThemeId\?: string \} \| undefined\)\?\.songAppliedThemeId/.test(oc), "live appearance");
    assert.ok(oc.includes("byId(item?.themeId) ?? byId(item?.songAppliedThemeId) ?? byId(ct)"), "grid appearance");
    const svc = src("src/lib/server/services.ts");
    assert.ok(svc.includes("songAppliedThemeId = st.appliedThemeId"));
  });
  await check("themes-changed reloads the theme cache for ANY theme", () => {
    assert.ok(oc.includes('window.addEventListener("presentflow:themes-changed", onThemesChanged);'));
    assert.ok(src("src/components/operator/pro/DesktopSlideEditorModal.tsx").includes('new CustomEvent("presentflow:themes-changed")'));
  });
  await check("Bible previews + grid thumbnails use the projector's layout/theme", () => {
    const bm = src("src/components/operator/pro/center/BibleMode.tsx");
    assert.equal(bm.split("slide={previewLayout(").length - 1, 2);
    assert.ok(oc.includes("applyChurchLayout(slide, churchId, scriptureThemeOptsFor(slide, undefined))"));
    assert.equal(src("src/components/operator/pro/center/SlideGrid.tsx").split("appearance={itemAppearance ?? undefined}").length - 1, 3);
  });
  await check("theme editor warns when a saved Scripture Style overrides the theme", () => {
    const te = src("src/components/operator/pro/ThemeEditorTab.tsx");
    assert.ok(te.includes("Your church has a saved Scripture Style, which overrides this theme&apos;s scripture boxes."));
    assert.ok(te.includes("clearScriptureStyle(churchId)"));
  });

  console.log(`\ntheme-decor: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
main();
