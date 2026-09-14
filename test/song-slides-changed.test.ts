/**
 * Run: npx tsx test/song-slides-changed.test.ts
 */
import assert from "node:assert/strict";
import { songSlidesChangedPlan, refreshTrackedSong, relocateLyricIndex } from "../src/lib/song-slides-changed";

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
check("Example A: insert intro at top, 2nd chorus live → stays the 2nd chorus (4)", () => {
  const r = refreshTrackedSong(track(["v1", "ch", "v2", "ch", "end"], 3), ["intro", "v1", "ch", "v2", "ch", "end"], norm("ch"), norm)!;
  assert.equal(r.currentIdx, 4);
  assert.equal(r.slides[r.currentIdx + 1], "end");
});
check("Example B: [ch,v,ch,v,ch] idx 2, insert x,y at top → 4 (not the stale old index)", () => {
  const r = refreshTrackedSong(track(["ch", "v", "ch", "v", "ch"], 2), ["x", "y", "ch", "v", "ch", "v", "ch"], norm("ch"), norm)!;
  assert.equal(r.currentIdx, 4);
});
check("delete v1 before the chorus: idx 3 → 2, next is end", () => {
  const r = refreshTrackedSong(track(["v1", "ch", "v2", "ch", "end"], 3), ["ch", "v2", "ch", "end"], norm("ch"), norm)!;
  assert.equal(r.currentIdx, 2);
  assert.equal(r.slides[r.currentIdx + 1], "end");
});
check("insert after the live copy: idx 1 stays 1", () => {
  const r = refreshTrackedSong(track(["v1", "ch", "v2", "ch", "end"], 1), ["v1", "ch", "new", "v2", "ch", "end"], norm("ch"), norm)!;
  assert.equal(r.currentIdx, 1);
});
check("new chorus copy appended (counts differ) → 3 via neighbours", () => {
  const r = refreshTrackedSong(track(["v1", "ch", "v2", "ch", "end"], 3), ["v1", "ch", "v2", "ch", "end", "ch"], norm("ch"), norm)!;
  assert.equal(r.currentIdx, 3);
});
check("neighbours edited + insert at top (counts differ) → 4 via offset", () => {
  const r = refreshTrackedSong(track(["v1", "ch", "v2", "ch", "end"], 3), ["ch", "v1x", "ch", "v2x", "ch", "endx"], norm("ch"), norm)!;
  assert.equal(r.currentIdx, 4);
});
check("fuzz: reorder with live slide still at its index → stays 2", () => {
  const r = refreshTrackedSong(track(["B", "B", "B", "B", "C", "C", "C", "C", "V3"], 2), ["C", "B", "B", "B", "C", "C", "B", "C", "V3"], norm("B"), norm)!;
  assert.equal(r.currentIdx, 2);
});
check("fuzz: edit a non-live slide after the live one → stays 2", () => {
  const r = refreshTrackedSong(track(["Tag", "Tag", "Tag", "Tag", "V3"], 2), ["Tag", "Tag", "Tag", "ChorusA", "V3"], norm("Tag"), norm)!;
  assert.equal(r.currentIdx, 2);
});
check("fuzz: insert Bridge,Verse1 after the live Verse1@8 → stays 8", () => {
  const old = ["a", "b", "c", "d", "e", "f", "Verse1", "Bridge", "Verse1", "ChorusA", "V2"];
  const fresh = [...old.slice(0, 9), "Bridge", "Verse1", ...old.slice(9)];
  const r = refreshTrackedSong(track(old, 8), fresh, norm("Verse1"), norm)!;
  assert.equal(r.currentIdx, 8);
});
check("Quick edit [A,X,A,Y] idx 2 → [Z,X,A,A] → 2", () => {
  const r = refreshTrackedSong(track(["A", "X", "A", "Y"], 2), ["Z", "X", "A", "A"], norm("A"), norm)!;
  assert.equal(r.currentIdx, 2);
});
check("structural-edit hint (tracking cleared): 2nd chorus stays the 2nd after Add slide", () => {
  const hint = { slides: ["v1", "ch", "v2", "ch", "end"], currentIdx: 3 };
  assert.equal(relocateLyricIndex(hint.slides, hint.currentIdx, ["v1", "ch", "v2", "ch", "new", "end"], norm("ch"), norm), 3);
  assert.equal(relocateLyricIndex(hint.slides, hint.currentIdx, ["added", "v1", "ch", "v2", "ch", "end"], norm("ch"), norm), 4);
  assert.equal(relocateLyricIndex(hint.slides, hint.currentIdx, ["v1", "v2", "end"], norm("ch"), norm), -1);
});
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
