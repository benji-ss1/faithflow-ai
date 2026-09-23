/**
 * Media sync + duplicate rule (2026-09-23). Run: npx tsx test/media-sync.test.ts
 */
import assert from "node:assert/strict";
import { mediaDupKey, findMediaDuplicates, duplicateIndex, extraCopyCount, isDuplicateUpload, describeMediaUsage, dupCopyCount } from "../src/lib/media-sync";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); pass++; console.log("PASS", name); } catch (e) { fail++; console.log("FAIL", name, e); }
}
const A = (id: string, fileName: string, kind: string, sizeBytes: number, createdAt = `2026-09-${id.padStart(2, "0")}`) =>
  ({ id, fileName, kind, sizeBytes, createdAt });

check("same name+kind+size is a duplicate (case/whitespace-insensitive)", () => {
  const g = findMediaDuplicates([A("1", "Worship.jpg", "image", 100), A("2", " worship.JPG ", "image", 100)]);
  assert.equal(g.length, 1); assert.equal(g[0].length, 2);
});
check("different size is NOT a duplicate", () => {
  assert.equal(findMediaDuplicates([A("1", "a.jpg", "image", 100), A("2", "a.jpg", "image", 101)]).length, 0);
});
check("image vs video with same name/size is NOT a duplicate", () => {
  assert.equal(findMediaDuplicates([A("1", "a", "image", 100), A("2", "a", "video", 100)]).length, 0);
});
check("mime-style kind normalises (video/mp4 == video)", () => {
  assert.equal(mediaDupKey({ fileName: "x.mp4", kind: "video/mp4", sizeBytes: 5 }), mediaDupKey({ fileName: "x.mp4", kind: "video", sizeBytes: 5 }));
});
check("unknown size (0, optimistic row) never flagged", () => {
  assert.equal(findMediaDuplicates([A("1", "a.png", "image", 0), A("2", "a.png", "image", 0)]).length, 0);
  assert.equal(mediaDupKey({ fileName: "", kind: "image", sizeBytes: 9 }), null);
});
check("five copies → one group, 4 extra, oldest first", () => {
  const list = ["5", "3", "1", "4", "2"].map((id) => A(id, "logo.png", "image", 42));
  const g = findMediaDuplicates(list);
  assert.equal(g.length, 1); assert.equal(extraCopyCount(g), 4);
  assert.deepEqual(g[0].map((a) => a.id), ["1", "2", "3", "4", "5"]);
});
check("index maps every member to its group; singletons absent", () => {
  const idx = duplicateIndex([A("1", "a", "image", 1), A("2", "a", "image", 1), A("3", "b", "image", 1)]);
  assert.equal(idx.get("1")?.length, 2); assert.equal(idx.has("3"), false);
});
check("incoming upload matches existing library", () => {
  const lib = [{ fileName: "Sermon BG.mp4", kind: "video", sizeBytes: 999 }];
  assert.equal(isDuplicateUpload({ name: "sermon bg.mp4", size: 999, type: "video/mp4" }, lib), true);
  assert.equal(isDuplicateUpload({ name: "sermon bg.mp4", size: 998, type: "video/mp4" }, lib), false);
  assert.equal(isDuplicateUpload({ name: "x.png", size: 1, type: "image/png" }, []), false);
});
check("scales: 5000 assets grouped quickly", () => {
  const list = Array.from({ length: 5000 }, (_, i) => A(String(i), `f${i % 2500}.jpg`, "image", 10 + (i % 2500)));
  const t = Date.now(); const g = findMediaDuplicates(list);
  assert.equal(g.length, 2500); assert.ok(Date.now() - t < 500);
});
check("usage copy: unused → null, used → plural-aware sentence", () => {
  assert.equal(describeMediaUsage({ playlistItems: 0, songs: 0, slides: 0, themes: 0, presets: 0 }), null);
  assert.equal(describeMediaUsage(null), null);
  const t = describeMediaUsage({ playlistItems: 2, songs: 0, slides: 1, themes: 1, presets: 0 })!;
  assert.ok(t.includes("2 playlist items") && t.includes("1 slide") && t.includes("1 theme") && !t.includes("song"));
});
check("dupCopyCount counts every copy (5 copies → 5)", () => {
  assert.equal(dupCopyCount([[1, 2, 3, 4, 5]]), 5);
});
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
