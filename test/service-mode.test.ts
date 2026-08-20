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

test("worship mode: off-plan song STILL SURFACES but is held at chip-tier (never auto)", async () => {
  reset();
  // Sing lyrics that ONLY match the off-plan song (a spontaneous, unplanned
  // song mid-worship — "sing real quick in the spirit"). Worship narrowing must
  // NOT hide it: it must still surface so the operator can one-tap fire it, but
  // it must be held below the 90 auto bar so only the setlist auto-projects.
  const res = await detectAll("amazing grace how sweet the sound that saved a wretch", { ...base, mode: "worship" });
  const offplan = [...res.song, ...res.lyric].find((s) => s.songId === "offplan");
  assert.ok(offplan, "off-plan song must STILL surface in worship mode (not dropped)");
  assert.ok(offplan!.confidence <= 89, `off-plan song must be held below the auto bar, got ${offplan!.confidence}`);
});

test("auto mode: off-plan song can surface at full confidence (contrast with worship)", async () => {
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

test("worship mode: a strong setlist match CAN reach zero-click auto (>=90)", async () => {
  reset();
  // A full, distinctive sung line from the planned song. In worship mode the
  // setlist nudge should carry a genuine match over the 90 auto bar so the
  // operator doesn't have to push it live ("why do I have to push it live?").
  const res = await detectAll("way maker miracle worker promise keeper light in the darkness", { ...base, mode: "worship" });
  const planned = [...res.song, ...res.lyric].find((s) => s.songId === "planned");
  assert.ok(planned, "planned song should be detected");
  assert.ok(planned!.confidence >= 90,
    `strong setlist match should auto-fire in worship; expected >=90, got ${planned!.confidence}`);
});

test("worship mode: an ASR-noise graze of a setlist song is NOT boosted to auto", async () => {
  reset();
  // Only a couple of common words graze the planned song — rawScore below the
  // worship-boost floor, so it must not be nudged toward auto-fire.
  const res = await detectAll("the light was on in the room", { ...base, mode: "worship" });
  const planned = [...res.song, ...res.lyric].find((s) => s.songId === "planned");
  if (planned) {
    assert.ok(planned.confidence < 90,
      `a noise graze must not auto-fire; expected <90, got ${planned.confidence}`);
  }
});
