/**
 * An image the operator cropped / blurred / framed in the media editor must come
 * with the picture whenever it becomes a BACKGROUND (Victor 2026-09-19): "Set as
 * global background", "Set as current slide's background", drag-onto-slide and the
 * hover "Bg" all used the original file and threw the edit away.
 * Run: npx tsx test/media-frame-bake.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isTrivialFrame, frameHash, fitRect, gradientLine, BAKE_BLUR_FILTER, bakeBlurFilter } from "../src/components/operator/pro/center/mediaFrameBakeMath";
import type { MediaFrame } from "../src/components/operator/pro/center/mediaFrame";

let pass = 0, fail = 0;
const check = (n: string, fn: () => void) => { try { fn(); console.log(`  PASS  ${n}`); pass++; } catch (e) { console.error(`  FAIL  ${n}\n        ${(e as Error).message}`); fail++; } };
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≉ ${b}`);
const base: MediaFrame = { fit: "cover", posX: 50, posY: 50, zoom: 1 };

console.log("frame classification:");
check("default frame (cover, centred, 1x) needs no bake", () => assert.equal(isTrivialFrame(base), true));
check("contain (Fit) is a real edit", () => assert.equal(isTrivialFrame({ ...base, fit: "contain" }), false));
check("pan is a real edit", () => assert.equal(isTrivialFrame({ ...base, posX: 20 }), false));
check("zoom is a real edit", () => assert.equal(isTrivialFrame({ ...base, zoom: 1.5 }), false));
check("blur-fill is a real edit", () => assert.equal(isTrivialFrame({ ...base, fit: "contain", blurFill: true }), false));
check("logo-on-background is a real edit", () => assert.equal(isTrivialFrame({ ...base, bgMode: "background" }), false));
check("a dragged crop box is a real edit", () => assert.equal(isTrivialFrame({ ...base, boxX: 10, boxY: 10, boxW: 900, boxH: 500 }), false));

console.log("cache identity:");
check("same frame → same hash regardless of key order", () => assert.equal(frameHash({ fit: "cover", posX: 1, posY: 2, zoom: 1 }), frameHash({ zoom: 1, posY: 2, posX: 1, fit: "cover" })));
check("re-editing changes the hash (a stale bake is never reused)", () => assert.notEqual(frameHash(base), frameHash({ ...base, zoom: 2 })));

console.log("placement (must equal CSS object-fit / object-position):");
check("contain letterboxes a portrait flyer in a 16:9 box, centred", () => {
  const r = fitRect(600, 1000, 0, 0, 1920, 1080, "contain", 50, 50);
  near(r.dh, 1080); near(r.dw, 648); near(r.dx, (1920 - 648) / 2); near(r.dy, 0);
});
check("cover fills the box and crops the overflow", () => {
  const r = fitRect(600, 1000, 0, 0, 1920, 1080, "cover", 50, 50);
  near(r.dw, 1920); near(r.dh, 3200); near(r.dy, (1080 - 3200) / 2);
});
check("pan moves the crop (posY 0 pins the top)", () => assert.equal(fitRect(600, 1000, 0, 0, 1920, 1080, "cover", 50, 0).dy, 0));
check("stretch (fill) ignores the aspect ratio", () => { const r = fitRect(600, 1000, 0, 0, 1920, 1080, "fill", 50, 50); near(r.dw, 1920); near(r.dh, 1080); });
check("a crop box offsets from its own corner", () => assert.equal(fitRect(1000, 1000, 100, 50, 500, 500, "contain", 50, 50).dx, 100));

console.log("gradient direction (CSS angles):");
check("90deg runs left → right", () => { const g = gradientLine(90, 0, 0, 1920, 1080); near(g.y0, 540); near(g.y1, 540); assert.ok(g.x0 < g.x1); });
check("180deg runs top → bottom", () => { const g = gradientLine(180, 0, 0, 1920, 1080); near(g.x0, 960); assert.ok(g.y0 < g.y1); });

console.log("blur look matches the renderer:");
check("blur filter string is the one SlideObjectsLayer uses", () => {
  assert.ok(read("src/components/live/SlideObjectsLayer.tsx").includes(BAKE_BLUR_FILTER));
});

console.log("every BACKGROUND path applies the saved edit:");
const bin = read("src/components/operator/pro/left/MediaBinSection.tsx");
const browser = read("src/components/operator/pro/center/MediaBrowser.tsx");
const grid = read("src/components/operator/pro/center/SlideGrid.tsx");
check("Media Bin: global background + hover Bg", () => assert.match(bin, /const setAsBackground = async[\s\S]*?resolveFramedBackground[\s\S]*?setMediaAsBackground/));
check("Media Bin: current slide's background", () => assert.match(bin, /const setCurrentSlideBg = async[\s\S]*?resolveFramedBackground[\s\S]*?bgImageUrl: fb\.url/));
check("Media Browser: set as background", () => assert.match(browser, /const setAsBackground = async[\s\S]*?resolveFramedBackground[\s\S]*?setMediaAsBackground/));
check("Slide grid: drop onto a slide", () => { assert.match(grid, /hasBakeableFrame/); assert.match(grid, /setSongSlideBackgroundImage\(slideId, bgUrl\)/); assert.match(grid, /setServiceItemSlideBackground\(itemId, idx, bgUrl\)/); });
check("Slide grid: drop into empty space (new image slide)", () => assert.match(grid, /createSongImageSlide\(editableSongId, insertIndex, fb\.url\)/));
check("no background path passes the raw payload url after a bake", () => assert.doesNotMatch(grid, /setSongSlideBackgroundImage\(slideId, payload\.url\)/));
check("baking never throws (falls back to the original)", () => assert.match(read("src/components/operator/pro/center/mediaFrameBake.ts"), /catch \{\s*return \{ \.\.\.original, failed: true \};/));

console.log("library tiles show the edit too:");
check("blur radius shrinks with the drawing scale (canvas filters ignore ctx.scale)", () => {
  assert.equal(bakeBlurFilter(1), BAKE_BLUR_FILTER);
  assert.equal(bakeBlurFilter(0.25), "blur(8.5px) brightness(0.62) saturate(1.08)");
});
const framedImg = read("src/components/operator/pro/center/FramedImage.tsx");
check("FramedImage redraws when an edit is saved and falls back to the plain <img>", () => {
  assert.match(framedImg, /MEDIA_FRAME_CHANGED_EVENT/);
  assert.match(framedImg, /if \(!framed\) \{[\s\S]*?<img src=\{src\}/);
  assert.match(framedImg, /drawFrame\(ctx, frame, im, scale\)/);
});
check("Media Bin tile + preview draw the edited image", () => {
  assert.match(bin, /<FramedImage churchId=\{ctx\?\.churchId\} assetId=\{a\.id\}/);
  assert.match(bin, /<FramedImage churchId=\{churchId\} assetId=\{asset\.id\}/);
  assert.doesNotMatch(bin, /<img src=\{a\.thumbUrl \|\| a\.url\}/);
});
check("Media Browser grid + reorder cards draw the edited image", () => {
  assert.match(browser, /<FramedImage churchId=\{ctx\.churchId\} assetId=\{a\.id\}/);
  assert.match(browser, /<FramedImage churchId=\{churchId\} assetId=\{asset\.id\}/);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
