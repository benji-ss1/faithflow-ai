// Song auto-switch guard (rule 7, 2026-09-14). Run: npx tsx test/song-switch-guard.test.ts
import assert from "node:assert/strict";
import { shouldHoldSongAutoSwitch } from "../src/lib/song-switch-guard";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}
const lyric = { kind: "text" as const, text: "Amazing grace how sweet the sound" };

check("A live (tracked) → B risen is HELD", () => {
  assert.equal(shouldHoldSongAutoSwitch({ targetSongId: "B", trackedLiveSongId: "A", liveSlide: lyric, liveItemType: "song" }), true);
});
check("library-sent untracked song live → B HELD", () => {
  assert.equal(shouldHoldSongAutoSwitch({ targetSongId: "B", trackedLiveSongId: null, liveSlide: lyric }), true);
});
check("short / shared line (untracked, song item) → HELD", () => {
  assert.equal(shouldHoldSongAutoSwitch({ targetSongId: "B", trackedLiveSongId: null, liveSlide: { kind: "text", text: "Hallelujah" }, liveItemType: "song" }), true);
});
check("banded song (lower third, no reference) untracked → HELD", () => {
  assert.equal(shouldHoldSongAutoSwitch({ targetSongId: "B", trackedLiveSongId: null, liveSlide: { kind: "text", text: "Holy holy holy", scriptureLayout: "lowerThird" } }), true);
});
check("scripture (reference field) live → song auto ALLOWED", () => {
  assert.equal(shouldHoldSongAutoSwitch({ targetSongId: "B", trackedLiveSongId: null, liveSlide: { kind: "text", text: "For God so loved", reference: "John 3:16 (KJV)" } }), false);
});
check("legacy plan scripture text ending in ref → ALLOWED", () => {
  assert.equal(shouldHoldSongAutoSwitch({ targetSongId: "B", trackedLiveSongId: null, liveSlide: { kind: "text", text: "16 For God so loved the world\n\nJohn 3:16" } }), false);
});
check("scripture plan item → ALLOWED", () => {
  assert.equal(shouldHoldSongAutoSwitch({ targetSongId: "B", trackedLiveSongId: null, liveSlide: lyric, liveItemType: "scripture" }), false);
});
check("blank / empty / logo / media → ALLOWED", () => {
  for (const s of [{ kind: "blank" }, { kind: "empty" }, { kind: "logo" }, { kind: "image", url: "https://a.b/c.png" }, { kind: "video", url: "https://a.b/c.mp4" }] as const) {
    assert.equal(shouldHoldSongAutoSwitch({ targetSongId: "B", trackedLiveSongId: null, liveSlide: s as never }), false);
  }
  assert.equal(shouldHoldSongAutoSwitch({ targetSongId: "B", trackedLiveSongId: null, liveSlide: null }), false);
  assert.equal(shouldHoldSongAutoSwitch({ targetSongId: "B", trackedLiveSongId: null, liveSlide: { kind: "text", text: "  " } }), false);
});
check("same song tracked live → NOT held (existing same-song skip handles it)", () => {
  assert.equal(shouldHoldSongAutoSwitch({ targetSongId: "A", trackedLiveSongId: "A", liveSlide: lyric }), false);
});
check("non-song plan item text (sermon) → ALLOWED", () => {
  assert.equal(shouldHoldSongAutoSwitch({ targetSongId: "B", trackedLiveSongId: null, liveSlide: { kind: "text", text: "Welcome everyone" }, liveItemType: "sermon" }), false);
});
console.log(`\n${pass} passed, ${fail} failed`);
assert.equal(fail, 0);
