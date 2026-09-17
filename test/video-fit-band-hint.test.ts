// Run: npx tsx test/video-fit-band-hint.test.ts
import assert from "node:assert";
import { videoObjectFit, shouldShowBandHint, bandHintKey, BAND_DEFAULT_COLOR } from "../src/lib/band-media";
assert.equal(videoObjectFit(undefined), "contain");
assert.equal(videoObjectFit("contain"), "contain");
assert.equal(videoObjectFit("cover"), "cover");
assert.equal(videoObjectFit("fill"), "fill");
assert.equal(videoObjectFit("bogus"), "contain");
assert.equal(shouldShowBandHint({ mode: "solid", color: "#000000" }, false), true);
assert.equal(shouldShowBandHint({ mode: "gradient", color: "#000000" }, false), true);
assert.equal(shouldShowBandHint({ mode: "solid", color: "#000000" }, true), false);
assert.equal(shouldShowBandHint({ mode: "none", color: "#000000" }, false), false);
assert.equal(shouldShowBandHint({ mode: "solid", color: "#000001" }, false), false);
assert.equal(shouldShowBandHint({ mode: "solid", color: BAND_DEFAULT_COLOR }, false), false);
assert.equal(shouldShowBandHint(null, false), false);
assert.equal(bandHintKey("c1"), "presentflow.bandHint.dismissed.c1");
console.log("video-fit-band-hint: all pass");
