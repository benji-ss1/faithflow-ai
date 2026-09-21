/**
 * PP7 parity R4: video trim, end-of-clip behaviour, rate and volume.
 *
 * Before this a slide video had only `loop` on/off and a `muted` boolean. No
 * trim (re-export the file to cut two seconds of slate), no end-of-clip choice
 * (a non-looping clip did whatever the browser felt like), no rate, and no
 * volume LEVEL — only "muted or full blast", which matters when a clip's audio
 * is hotter than the band.
 *
 * Every default must reproduce today's behaviour exactly.
 *
 * Run: npx tsx test/video-playback.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  resolveEndAction, resolveTrim, resolveRate, resolveVolume,
  pastOut, beforeIn, needsSupervision, MIN_RATE, MAX_RATE,
} from "../src/lib/video-playback";

let pass = 0, fail = 0;
const check = (n: string, fn: () => void) => {
  try { fn(); console.log(`  PASS  ${n}`); pass++; }
  catch (e) { console.error(`  FAIL  ${n}\n        ${(e as Error).message}`); fail++; }
};

console.log("every existing slide keeps behaving exactly as it did:");
check("no endAction: loop:true -> loop, loop:false -> freeze, absent -> loop", () => {
  assert.equal(resolveEndAction({ loop: true }), "loop");
  assert.equal(resolveEndAction({ loop: false }), "freeze");
  assert.equal(resolveEndAction({}), "loop", "loop has always defaulted true");
});
check("an explicit endAction wins over loop", () => {
  assert.equal(resolveEndAction({ loop: true, endAction: "freeze" }), "freeze");
  assert.equal(resolveEndAction({ loop: false, endAction: "loop" }), "loop");
});
check("no trim, plain loop/freeze -> the browser handles it, we do NOT supervise", () => {
  assert.equal(needsSupervision({}), false, "the common case must cost nothing");
  assert.equal(needsSupervision({ loop: false }), false);
});
check("trim or 'clear' turns supervision on", () => {
  assert.equal(needsSupervision({ inSec: 2 }), true);
  assert.equal(needsSupervision({ outSec: 9 }), true);
  assert.equal(needsSupervision({ endAction: "clear" }), true);
});
check("absent rate is 1, absent volume is muted", () => {
  assert.equal(resolveRate({}), 1);
  assert.deepEqual(resolveVolume({}), { muted: true, volume: 1 });
});

console.log("trim does what the operator asked:");
check("in/out are honoured", () => {
  assert.deepEqual(resolveTrim({ inSec: 2, outSec: 8 }, 30), { start: 2, end: 8 });
});
check("absent out plays to the end of the file", () => {
  assert.deepEqual(resolveTrim({ inSec: 5 }, 30), { start: 5, end: 30 });
});
check("points beyond the file are clamped to it", () => {
  assert.deepEqual(resolveTrim({ inSec: 1, outSec: 999 }, 30), { start: 1, end: 30 });
});

console.log("a bad trim can never produce a dead frame:");
check("out <= in falls back to the WHOLE clip, not to nothing", () => {
  assert.deepEqual(resolveTrim({ inSec: 10, outSec: 3 }, 30), { start: 0, end: 30 });
  assert.deepEqual(resolveTrim({ inSec: 5, outSec: 5 }, 30), { start: 0, end: 30 });
});
check("NaN / Infinity / negatives never reach the element", () => {
  assert.deepEqual(resolveTrim({ inSec: NaN, outSec: NaN }, 30), { start: 0, end: 30 });
  assert.deepEqual(resolveTrim({ inSec: -5 }, 30), { start: 0, end: 30 });
  assert.deepEqual(resolveTrim({ inSec: Infinity }, 30), { start: 0, end: 30 });
});
check("an unknown duration (metadata not loaded yet) is safe", () => {
  for (const d of [0, NaN, Infinity, -1]) {
    const t = resolveTrim({ inSec: 2, outSec: 8 }, d);
    assert.equal(t.start, 0, `duration ${d}`);
    assert.equal(t.end, 0);
  }
});

console.log("rate and volume are clamped:");
check("rate stays within 0.25-4 and a bad value is 1", () => {
  assert.equal(resolveRate({ rate: 0.1 }), MIN_RATE);
  assert.equal(resolveRate({ rate: 99 }), MAX_RATE);
  assert.equal(resolveRate({ rate: 1.5 }), 1.5);
  for (const r of [0, -1, NaN, Infinity]) assert.equal(resolveRate({ rate: r }), 1, String(r));
});
check("volume is 0-1 and muted always wins", () => {
  assert.deepEqual(resolveVolume({ muted: false, volume: 0.4 }), { muted: false, volume: 0.4 });
  assert.deepEqual(resolveVolume({ muted: false, volume: 5 }), { muted: false, volume: 1 });
  assert.deepEqual(resolveVolume({ muted: false, volume: -2 }), { muted: false, volume: 0 });
  assert.equal(resolveVolume({ muted: true, volume: 1 }).muted, true, "muted must still win");
});

console.log("the out-point fires reliably despite coarse timeupdate:");
check("tolerance absorbs timeupdate overshoot (~250ms granularity)", () => {
  const t = { start: 2, end: 8 };
  assert.equal(pastOut(7.99, t), true, "just short must still count, or the clip overruns");
  assert.equal(pastOut(7.5, t), false);
  assert.equal(pastOut(8.4, t), true);
});
check("a seek before the in-point is detected", () => {
  const t = { start: 2, end: 8 };
  assert.equal(beforeIn(0, t), true);
  assert.equal(beforeIn(2, t), false);
  assert.equal(beforeIn(NaN, t), false, "NaN must not trigger an endless seek");
});

console.log("the renderer applies it correctly:");
check("we drive looping ourselves ONLY while supervising", () => {
  const src = readFileSync(new URL("../src/components/live/SlideVideo.tsx", import.meta.url), "utf8");
  assert.match(src, /loop=\{supervise \? false : endAction === "loop"\}/,
    "the browser's own loop would fight our out-point");
});
check("'clear' removes the video so what is behind shows through", () => {
  const src = readFileSync(new URL("../src/components/live/SlideVideo.tsx", import.meta.url), "utf8");
  assert.match(src, /if \(cleared\) return null/);
  assert.match(src, /setCleared\(false\)/, "a new clip must not inherit the last one's cleared state");
});
check("a failed video still hides on the projector and tells the operator", () => {
  const src = readFileSync(new URL("../src/components/live/SlideVideo.tsx", import.meta.url), "utf8");
  assert.match(src, /visibility = "hidden"/);
  assert.match(src, /reportMediaFailure/);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
