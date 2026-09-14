/**
 * Run: npx tsx test/song-slides-changed.test.ts
 */
import assert from "node:assert/strict";
import { songSlidesChangedPlan } from "../src/lib/song-slides-changed";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}

check("Add slide (no flag) on the live song → invalidate + clear tracking (unchanged)", () => {
  assert.deepEqual(songSlidesChangedPlan({ songId: "a" }, "a"), { invalidate: true, clearLiveTracking: true });
});
check("Quick edit save (keepLiveTracking) on the live song → invalidate, KEEP tracking", () => {
  assert.deepEqual(songSlidesChangedPlan({ songId: "a", keepLiveTracking: true }, "a"), { invalidate: true, clearLiveTracking: false });
});
check("edit of a non-live song → invalidate only", () => {
  assert.deepEqual(songSlidesChangedPlan({ songId: "b" }, "a"), { invalidate: true, clearLiveTracking: false });
});
check("nothing live → invalidate only", () => {
  assert.deepEqual(songSlidesChangedPlan({ songId: "a" }, null), { invalidate: true, clearLiveTracking: false });
});
check("missing songId → no-op", () => {
  assert.deepEqual(songSlidesChangedPlan({}, "a"), { invalidate: false, clearLiveTracking: false });
  assert.deepEqual(songSlidesChangedPlan(undefined, "a"), { invalidate: false, clearLiveTracking: false });
});
check("keepLiveTracking must be literally true (truthy strings don't count)", () => {
  assert.equal(songSlidesChangedPlan({ songId: "a", keepLiveTracking: "yes" as unknown as boolean }, "a").clearLiveTracking, true);
});

console.log(`\nsong-slides-changed: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
