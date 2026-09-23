/**
 * Regression lock (user-directed 2026-09-17): clicking media in the Media Bin or
 * the Media library sends it LIVE as a slide. Only the explicit "Bg" button /
 * "Set as background" actions may change the background behind every slide.
 *
 * 2026-09-24 (Layer Order V3, docs/COMPOSABLE_PLAN_2026-09-23.md Addendum A
 * decision 13): behind the DEFAULT-OFF `readLayerOrderV3Flag()` gate ONLY, a
 * click may set the media layer instead. The lock below still holds for every
 * flag-off path: the only permitted background call is the exact flag-gated
 * branch, stripped out before the "never a background" assertions run.
 * Run: npx tsx test/media-click-sends-live.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { mediaClickAction } from "../src/lib/media-click";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}
const bin = fs.readFileSync("src/components/operator/pro/left/MediaBinSection.tsx", "utf8");
const browser = fs.readFileSync("src/components/operator/pro/center/MediaBrowser.tsx", "utf8");

/** Remove the ONE permitted, default-off Layer Order V3 branch. */
const V3_BIN = "if (readLayerOrderV3Flag()) void setAsBackground(a); else ";
const withoutV3 = (src: string) => src.split(V3_BIN).join("");

/** Body of the first function/arrow starting at `marker`, by brace matching. */
function bodyAfter(src: string, marker: string): string {
  const i = src.indexOf(marker);
  assert.ok(i >= 0, `marker not found: ${marker}`);
  const open = src.indexOf("{", i);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") { depth--; if (depth === 0) return src.slice(open, j + 1); }
  }
  throw new Error("unbalanced");
}

check("pure: images, videos, unknown kinds → send live", () => {
  for (const k of ["image", "image/png", "video", "video/mp4", "", null, undefined]) assert.equal(mediaClickAction(k), "send-live");
});
check("pure: audio is blocked, never sent live or set as background", () => {
  for (const k of ["audio", "audio/mpeg", "AUDIO"]) assert.equal(mediaClickAction(k), "audio-blocked");
});
check("both click paths route through mediaClickAction", () => {
  assert.match(withoutV3(bin), /mediaClickAction\(a\.kind\) === "send-live"\) \{ sendAsSlide\(a\); \}/);
  assert.match(browser, /mediaClickAction\(a\.kind\) === "audio-blocked"/);
});
check("Media Bin tile click timer sends the asset live", () => {
  const timer = withoutV3(bodyAfter(bin, "clickTimerRef.current = window.setTimeout("));
  assert.match(timer, /sendAsSlide\(a\)/);
  assert.doesNotMatch(timer, /setMediaAsBackground|setAsBackground|MediaLayer/);
});
check("Media Bin has no click-to-media-layer path", () => {
  assert.doesNotMatch(bin, /sendToMediaLayer/);
});
check("Media Bin keeps the explicit Bg button", () => {
  assert.match(bin, /aria-label="Set as background"[\s\S]{0,300}setAsBackground\(a\)/);
});
check("Media library click (sendLive) sends a slide live, never a background", () => {
  const body = bodyAfter(browser, "const sendLive = (a: Asset) =>");
  assert.match(body, /ctx\.onSendSlideToLive\(toSlide\(a\)\)/);
  assert.doesNotMatch(body.split("action:")[0], /setMediaAsBackground/);
});
check("Media library clickMedia: flag-off (and audio) path falls back to sendLive", () => {
  // The ONLY background branch is gated on the default-off V3 reader AND a
  // projectable kind; everything else is the unchanged sendLive(x).
  assert.match(browser, /const clickMedia = \(x: Asset\) => \(readLayerOrderV3Flag\(\) && mediaClickAction\(x\.kind\) !== "audio-blocked" \? void setAsBackground\(x\) : sendLive\(x\)\);/);
  // Both single-click paths (video immediately, image after the dblclick window) go through it.
  assert.match(browser, /if \(a\.kind\.startsWith\("video"\)\) \{ clickMedia\(a\); return; \}/);
  assert.match(browser, /clickTimerRef\.current = null; clickMedia\(a\); \}, 350\)/);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
