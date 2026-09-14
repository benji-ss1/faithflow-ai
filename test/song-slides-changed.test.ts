/**
 * Run: npx tsx test/song-slides-changed.test.ts
 */
import assert from "node:assert/strict";
import { songSlidesChangedPlan, refreshTrackedSong } from "../src/lib/song-slides-changed";

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
const track = (slides: string[], currentIdx: number) => ({ songId: "a", title: "T", slides, currentIdx, confirmedAt: 1 });

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

check("(a) typo fix on the NEXT slide → tracked next slide has the new text", () => {
  const live = track(["Amazing grace", "how sweeet the sound"], 0);
  const r = refreshTrackedSong(live, ["Amazing grace", "how sweet the sound"], norm("Amazing grace"), norm)!;
  assert.equal(r.currentIdx, 0);
  assert.equal(r.slides[r.currentIdx + 1], "how sweet the sound");
});
check("(b) blank slide 3 filled while slide 2 live → advance targets new slide 3, not 4", () => {
  // fetchSongLyricSlides drops empty lyrics, so the pre-fill list had no slide 3.
  const live = track(["one", "two", "four"], 1);
  const r = refreshTrackedSong(live, ["one", "two", "three", "four"], norm("two"), norm)!;
  assert.equal(r.currentIdx, 1);
  assert.equal(r.slides[r.currentIdx + 1], "three");
});
check("(c) index-shifting edit keeps currentIdx on the live text", () => {
  const live = track(["a line", "b line", "c line"], 2);
  const r = refreshTrackedSong(live, ["a line", "new line", "b line", "c line"], norm("c line"), norm)!;
  assert.equal(r.currentIdx, 3);
  assert.equal(r.slides[r.currentIdx], "c line");
});
check("(c2) repeated chorus: old index still holds the live text → it is kept (not snapped to the first copy)", () => {
  const live = track(["chorus", "verse", "chorus"], 2);
  const r = refreshTrackedSong(live, ["chorus", "verse", "chorus", "tag"], norm("chorus"), norm)!;
  assert.equal(r.currentIdx, 2);
  assert.equal(r.slides[r.currentIdx + 1], "tag");
});
// Known limit (same tie-break as resolveLyricIndex): if an insert moves BOTH
// chorus copies equidistant from the old index, the earlier copy wins.
check("live text edited away → null (caller re-searches, same as main's rebuild)", () => {
  assert.equal(refreshTrackedSong(track(["x", "y"], 1), ["x", "z"], norm("y"), norm), null);
});
check("(d) no-flag / unchanged cache: same slides reference → identical object returned", () => {
  const slides = ["x", "y"];
  const live = track(slides, 1);
  assert.strictEqual(refreshTrackedSong(live, slides, norm("y"), norm), live);
  assert.strictEqual(refreshTrackedSong(live, undefined, norm("y"), norm), live);
});
check("(d) no-flag path still clears tracking (Add slide behaviour unchanged)", () => {
  assert.equal(songSlidesChangedPlan({ songId: "a" }, "a").clearLiveTracking, true);
});

console.log(`\nsong-slides-changed: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
