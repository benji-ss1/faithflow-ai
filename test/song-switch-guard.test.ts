// Song auto-switch guard (rule 7, 2026-09-14 — POSITIVE EVIDENCE revision).
// Run: npx tsx test/song-switch-guard.test.ts
import assert from "node:assert/strict";
import { shouldHoldSongAutoSwitch, inferLiveOrigin, liveOriginKey, recallOrigin, rememberOrigin, carriedOrigin, type LiveOrigin } from "../src/lib/song-switch-guard";
import { parseLiveScriptureRef } from "../src/lib/bible-antireplay";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}
const hold = (i: Parameters<typeof shouldHoldSongAutoSwitch>[0]) => shouldHoldSongAutoSwitch(i);
const lyric = { kind: "text", text: "Amazing grace how sweet the sound" };

// ── ALLOW (no positive evidence a different song is live) ──
check("Welcome slide (origin text) → ALLOW", () => {
  assert.equal(hold({ targetSongId: "B", trackedLiveSongId: null, liveSlide: { kind: "text", text: "Welcome to church!" }, liveOrigin: { kind: "text" } }), false);
});
check("announcement (non-song plan item) → ALLOW", () => {
  assert.equal(hold({ targetSongId: "B", trackedLiveSongId: null, liveSlide: { kind: "text", text: "Youth meeting Friday 6pm" }, liveItemType: "announcement" }), false);
});
check("sermon point (sermon plan item) → ALLOW", () => {
  assert.equal(hold({ targetSongId: "B", trackedLiveSongId: null, liveSlide: { kind: "text", text: "Point 1: Faith that works" }, liveItemType: "sermon" }), false);
});
check("pasted free text, unknown origin → ALLOW", () => {
  assert.equal(hold({ targetSongId: "B", trackedLiveSongId: null, liveSlide: { kind: "text", text: "Holy holy holy lord god almighty" }, liveOrigin: null }), false);
});
check("scripture WITHOUT reference (origin scripture) → ALLOW", () => {
  assert.equal(hold({ targetSongId: "B", trackedLiveSongId: null, liveSlide: { kind: "text", text: "For God so loved the world" }, liveOrigin: { kind: "scripture" } }), false);
});
check("scripture with reference → ALLOW", () => {
  assert.equal(hold({ targetSongId: "B", trackedLiveSongId: null, liveSlide: { kind: "text", text: "For God so loved" }, liveOrigin: inferLiveOrigin({ kind: "text", reference: "John 3:16" }) }), false);
});
check("blank / empty / logo / media → ALLOW (even with stale song origin)", () => {
  for (const s of [{ kind: "blank" }, { kind: "empty" }, { kind: "logo" }, { kind: "image" }, { kind: "video" }]) {
    assert.equal(hold({ targetSongId: "B", trackedLiveSongId: null, liveSlide: s, liveOrigin: { kind: "song", songId: "A" } }), false);
  }
  assert.equal(hold({ targetSongId: "B", trackedLiveSongId: null, liveSlide: null }), false);
  assert.equal(hold({ targetSongId: "B", trackedLiveSongId: null, liveSlide: { kind: "text", text: "  " }, liveOrigin: { kind: "song", songId: "A" } }), false);
});
check("output restored from another device (unknown origin, lyric text) → ALLOW", () => {
  assert.equal(hold({ targetSongId: "B", trackedLiveSongId: null, liveSlide: lyric }), false);
});

// ── HOLD (positive evidence) ──
check("different TRACKED song live → HOLD", () => {
  assert.equal(hold({ targetSongId: "B", trackedLiveSongId: "A", liveSlide: lyric }), true);
});
check("library-sent song (origin song A, untracked) → HOLD", () => {
  assert.equal(hold({ targetSongId: "B", trackedLiveSongId: null, liveSlide: lyric, liveOrigin: { kind: "song", songId: "A" } }), true);
});
check("song origin with unknown songId → HOLD", () => {
  assert.equal(hold({ targetSongId: "B", trackedLiveSongId: null, liveSlide: lyric, liveOrigin: { kind: "song" } }), true);
});
check("setlist song on screen (plan song item A, untracked short line) → HOLD", () => {
  assert.equal(hold({ targetSongId: "B", trackedLiveSongId: null, liveSlide: { kind: "text", text: "Hallelujah" }, liveItemType: "song", liveItemSongId: "A" }), true);
});
check("post-song-ended: last lyric of A still live → B HOLD (signed-off rule)", () => {
  assert.equal(hold({ targetSongId: "B", trackedLiveSongId: null, liveSlide: { kind: "text", text: "Amen amen" }, liveOrigin: { kind: "song", songId: "A" } }), true);
});

// ── same-song skip ──
check("same song tracked / origin / plan → NOT held", () => {
  assert.equal(hold({ targetSongId: "A", trackedLiveSongId: "A", liveSlide: lyric }), false);
  assert.equal(hold({ targetSongId: "A", trackedLiveSongId: null, liveSlide: lyric, liveOrigin: { kind: "song", songId: "A" } }), false);
  assert.equal(hold({ targetSongId: "A", trackedLiveSongId: null, liveSlide: lyric, liveItemType: "song", liveItemSongId: "A" }), false);
});

// ── helpers ──
check("inferLiveOrigin never claims song", () => {
  assert.deepEqual(inferLiveOrigin({ kind: "text" }), { kind: "text" });
  assert.deepEqual(inferLiveOrigin({ kind: "image" }), { kind: "media" });
  assert.deepEqual(inferLiveOrigin({ kind: "blank" }), { kind: "other" });
});
check("liveOriginKey changes with origin", () => {
  assert.notEqual(liveOriginKey({ trackedLiveSongId: null, liveOrigin: { kind: "song", songId: "A" } }), liveOriginKey({ trackedLiveSongId: null, liveOrigin: { kind: "text" } }));
});
check("scripture ref parser accepts en-dash / em-dash ranges", () => {
  assert.equal(parseLiveScriptureRef("John 3:16–18")?.verseEnd, 18);
  assert.equal(parseLiveScriptureRef("John 3:16—18 (KJV)")?.verseEnd, 18);
  assert.equal(parseLiveScriptureRef("John 3:16-18")?.verseEnd, 18);
});
check("autoLiveSong-sent song NOT in plan, liveSongRef null → different song HOLD", () => {
  // autoLiveSong now declares { origin: song A }; nothing tracked, no plan item.
  assert.equal(hold({ targetSongId: "B", trackedLiveSongId: null, liveSlide: lyric, liveOrigin: { kind: "song", songId: "A" }, liveItemType: undefined }), true);
  // …and without the declared origin the same situation would (wrongly) ALLOW — the bug.
  assert.equal(hold({ targetSongId: "B", trackedLiveSongId: null, liveSlide: lyric, liveOrigin: inferLiveOrigin(lyric) }), false);
});
check("originById LRU: hit refreshes recency, cap 300 evicts least-recent", () => {
  const m = new Map<string, LiveOrigin>();
  for (let i = 0; i < 300; i++) rememberOrigin(m, `id${i}`, { kind: "song", songId: `S${i}` });
  assert.equal(recallOrigin(m, "id0")?.songId, "S0"); // refresh id0
  rememberOrigin(m, "id300", { kind: "song", songId: "S300" });
  assert.equal(m.size, 300);
  assert.equal(m.has("id0"), true);
  assert.equal(m.has("id1"), false);
  rememberOrigin(m, "id5", { kind: "text" }); // re-set does not grow
  assert.equal(m.size, 300);
});
check("re-send of live slide carries previous origin (bg drop / edit / theme)", () => {
  const A: LiveOrigin = { kind: "song", songId: "A" };
  assert.deepEqual(carriedOrigin(A, { kind: "text", text: "Amazing grace how sweet the sound " }, lyric), A); // same text, new bg
  assert.deepEqual(carriedOrigin(A, { kind: "text", text: "edited line" }, lyric, true), A); // explicit carry
  assert.equal(carriedOrigin(A, { kind: "text", text: "Different slide" }, lyric), undefined); // new content re-infers
  assert.equal(carriedOrigin(null, { kind: "text", text: lyric.text }, lyric, true), undefined);
  assert.equal(carriedOrigin(A, { kind: "image" }, lyric, true), undefined);
});
check("SWITCH HELD key stable across slide advance of the same live song", () => {
  const k1 = liveOriginKey({ trackedLiveSongId: null, liveOrigin: { kind: "song", songId: "A" } });
  const k2 = liveOriginKey({ trackedLiveSongId: null, liveOrigin: { kind: "song", songId: "A" } });
  assert.equal(k1, k2);
});
console.log(`\n${pass} passed, ${fail} failed`);
assert.equal(fail, 0);
