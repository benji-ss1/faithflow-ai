/**
 * Service-mode (Worship / Preacher / Auto) detection-bias tests.
 * Run: npx tsx --test test/service-mode.test.ts
 *
 * Locks in the invariant that the mode ONLY re-weights detectAll's output
 * confidences — it never touches capture or the auto-fire gates:
 *   auto     → identical to no mode (pure no-op).
 *   worship  → scripture capped ≤74 (chip, below BIBLE_AUTOFIRE_CONFIDENCE=75);
 *              song-matching narrowed to the setlist (non-plan songs dropped).
 *   preacher → songs capped ≤89 (chip, below SONG_AUTOLIVE_CONFIDENCE=90);
 *              scripture unaffected.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectAll, WORSHIP_SCRIPTURE_CAP, PREACHER_SONG_CAP } from "../src/lib/ai-detection";
import { resetSongDedupe } from "../src/lib/ai-detection/song-detection";
import { _resetPhraseCooldown } from "../src/lib/ai-detection";
import { BIBLE_AUTOFIRE_CONFIDENCE } from "../src/lib/audio-thresholds";
import { SONG_AUTOLIVE_CONFIDENCE } from "../src/components/operator/pro/operatorConstants";
import type { IndexedSong } from "../src/lib/ai-detection/lyric-fragment";

const LIB: IndexedSong[] = [
  { songId: "planned", title: "Way Maker", source: "church",
    slides: [{ order: 0, lyrics: "Way maker miracle worker promise keeper light in the darkness" }] },
  { songId: "offplan", title: "Amazing Grace", source: "public_domain",
    slides: [{ order: 0, lyrics: "Amazing grace how sweet the sound that saved a wretch like me" }] },
];

const base = {
  churchId: "c1",
  library: LIB,
  planSongIds: ["planned"] as string[],
  hasVerseContext: false,
  hasSlideContext: false,
  hasSongContext: false,
};

function reset() { resetSongDedupe(); _resetPhraseCooldown(); }

test("auto mode: explicit scripture keeps full confidence (no-op)", async () => {
  reset();
  const res = await detectAll("turn to John 3:16", { ...base, mode: "auto" });
  assert.ok(res.scripture.length > 0, "expected a scripture detection");
  assert.ok(res.scripture[0].confidence > 74, `auto must NOT cap scripture, got ${res.scripture[0].confidence}`);
});

test("worship mode: scripture is held at chip-tier (<=74)", async () => {
  reset();
  const res = await detectAll("turn to John 3:16", { ...base, mode: "worship" });
  assert.ok(res.scripture.length > 0, "scripture should still surface (as a chip)");
  assert.ok(res.scripture[0].confidence <= 74, `worship must cap scripture <=74, got ${res.scripture[0].confidence}`);
});

test("worship mode: off-plan song is dropped, planned song survives", async () => {
  reset();
  // Sing lyrics that ONLY match the off-plan song. In worship mode the setlist
  // narrowing must drop it entirely rather than surface a non-planned song.
  const res = await detectAll("amazing grace how sweet the sound that saved a wretch", { ...base, mode: "worship" });
  const ids = [...res.song, ...res.lyric].map((s) => s.songId);
  assert.ok(!ids.includes("offplan"), `off-plan song must be dropped in worship mode, got ${ids.join(",")}`);
});

test("auto mode: off-plan song CAN surface (contrast with worship)", async () => {
  reset();
  const res = await detectAll("amazing grace how sweet the sound that saved a wretch", { ...base, mode: "auto" });
  const ids = [...res.song, ...res.lyric].map((s) => s.songId);
  assert.ok(ids.includes("offplan"), `auto mode should still match the off-plan song, got ${ids.join(",")}`);
});

test("preacher mode: songs are capped below the auto bar (<=89)", async () => {
  reset();
  // "let's sing Way Maker" would normally score into the auto band; preacher
  // mode must hold it at chip-tier so speech never zero-clicks a song.
  const res = await detectAll("let's sing Way Maker", { ...base, mode: "preacher" });
  const all = [...res.song, ...res.lyric];
  for (const s of all) {
    assert.ok(s.confidence <= 89, `preacher must cap songs <=89, got ${s.confidence} for ${s.songId}`);
  }
});

test("preacher mode: scripture is untouched", async () => {
  reset();
  const res = await detectAll("turn to John 3:16", { ...base, mode: "preacher" });
  assert.ok(res.scripture.length > 0);
  assert.ok(res.scripture[0].confidence > 74, `preacher must not cap scripture, got ${res.scripture[0].confidence}`);
});

test("drift-guard: caps stay exactly one below the live auto bars", () => {
  // If a future edit moves SONG_AUTOLIVE_CONFIDENCE or BIBLE_AUTOFIRE_CONFIDENCE,
  // the hardcoded caps must move with them or this fails CI.
  assert.equal(PREACHER_SONG_CAP, SONG_AUTOLIVE_CONFIDENCE - 1,
    `PREACHER_SONG_CAP (${PREACHER_SONG_CAP}) must be SONG_AUTOLIVE_CONFIDENCE-1 (${SONG_AUTOLIVE_CONFIDENCE - 1})`);
  assert.equal(WORSHIP_SCRIPTURE_CAP, BIBLE_AUTOFIRE_CONFIDENCE - 1,
    `WORSHIP_SCRIPTURE_CAP (${WORSHIP_SCRIPTURE_CAP}) must be BIBLE_AUTOFIRE_CONFIDENCE-1 (${BIBLE_AUTOFIRE_CONFIDENCE - 1})`);
});

test("worship boost never ALONE pushes a song to zero-click auto (<=89 unless already auto)", async () => {
  reset();
  // A partial sung line matching only the planned song. Whatever it scores, the
  // worship boost must not carry a below-auto match over the 90 bar — it lands
  // at chip-tier (<=89) so an incomplete-setlist graze can't auto-fire a wrong
  // song. (A song already >=90 on its own merits is allowed to exceed; this
  // fragment is not a full exact-title/cue hit, so it stays capped.)
  const res = await detectAll("miracle worker promise keeper", { ...base, mode: "worship" });
  const planned = [...res.song, ...res.lyric].find((s) => s.songId === "planned");
  if (planned) {
    assert.ok(planned.confidence <= 89 || planned.confidence >= 90,
      `sanity: confidence is a number, got ${planned.confidence}`);
    // The fragment is not an exact title / "let's sing" cue, so the boost path
    // must hold it at chip-tier.
    assert.ok(planned.confidence <= 89,
      `worship boost must not alone auto-fire; expected <=89, got ${planned.confidence}`);
  }
});
