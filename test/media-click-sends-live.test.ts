/**
 * Regression lock (user-directed 2026-09-17): clicking media in the Media Bin or
 * the Media library sends it LIVE as a slide. Only the explicit "Bg" button /
 * "Set as background" actions may change the background behind every slide.
 * Run: npx tsx test/media-click-sends-live.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}
const bin = fs.readFileSync("src/components/operator/pro/left/MediaBinSection.tsx", "utf8");
const browser = fs.readFileSync("src/components/operator/pro/center/MediaBrowser.tsx", "utf8");

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

check("Media Bin tile click timer sends the asset live", () => {
  const timer = bodyAfter(bin, "clickTimerRef.current = window.setTimeout(");
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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
