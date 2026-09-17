// Band media geometry (lower-third image/video). Run: npx tsx test/band-media.test.ts
import assert from "node:assert";
import { bandMediaBox, fitMediaInBox, isNarrowMedia, bandCaptionPx } from "../src/lib/band-media";
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.01, `${a} != ${b}`);

const b = bandMediaBox(68, 30);
assert.equal(b.leftPct, 6); assert.equal(b.widthPct, 88); close(b.topPct, 69.8); close(b.heightPct, 26.4);
let r = fitMediaInBox(1920, 1080, 1000, 200); close(r.hPct, 100); close(r.wPct, 35.5556);
r = fitMediaInBox(64, 64, 1000, 300); close(r.wPct, 9.6); close(r.hPct, 32);
assert.deepEqual(fitMediaInBox(0, 0, 100, 100), { wPct: 100, hPct: 100 });
assert.equal(isNarrowMedia(1080, 1920), true); assert.equal(isNarrowMedia(1000, 1000), false);
assert.equal(bandCaptionPx(30), 84); assert.equal(bandCaptionPx(2), 16);
console.log("band-media: all pass");
