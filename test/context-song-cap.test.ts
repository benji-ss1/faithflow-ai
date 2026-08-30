/**
 * Context Engine Phase 1 — end-to-end: a strong song match is CAPPED to chip-
 * tier when the ContextEngine says we're in a spoken context (prayer/preaching/
 * reading), and detectAll is BYTE-IDENTICAL when no context is supplied
 * (flag-off parity). The engine's classification itself is covered by
 * context-engine.test.ts; this proves the wiring into detectAll.
 *
 * Run: npx tsx test/context-song-cap.test.ts
 */
import assert from "node:assert/strict";
import { detectAll, type DetectAllContext } from "../src/lib/ai-detection";
import { ContextEngine } from "../src/lib/ai-detection/context-engine";
import type { IndexedSong } from "../src/lib/ai-detection/lyric-fragment";

let passed = 0, failed = 0;
function test(name: string, fn: () => Promise<void>) {
  return fn().then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((e) => { failed++; console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : e}`); });
}

const library: IndexedSong[] = [{
  songId: "song-ag", title: "Amazing Grace", artist: "John Newton", source: "public_domain",
  slides: [
    { order: 1, lyrics: "Amazing grace how sweet the sound\nThat saved a wretch like me" },
    { order: 2, lyrics: "I once was lost but now am found\nWas blind but now I see" },
  ],
}];
const baseCtx: DetectAllContext = {
  // In-plan + recently-seen so the lyric match clears the 85 auto bar (the case
  // that matters: a plan song's words grazed mid-prayer would otherwise zero-click).
  churchId: "c1", planSongIds: ["song-ag"], recentSongIds: ["song-ag"], library,
  hasVerseContext: false, hasSlideContext: true, hasSongContext: true,
};
const LYRIC = "amazing grace how sweet the sound that saved a wretch like me";
const topSong = (r: { song: { confidence: number }[]; lyric: { confidence: number }[] }) =>
  Math.max(0, ...r.song.map((m) => m.confidence), ...r.lyric.map((m) => m.confidence));

async function main() {
  // Baseline: strong lyric match scores above the 84 chip cap with no context.
  const off = await detectAll(LYRIC, baseCtx);
  await test("baseline: strong song match scores > 84 with no context", async () => {
    assert.ok(topSong(off) > 84, `expected >84, got ${topSong(off)}`);
  });

  // Flag-off parity: context: undefined must be byte-identical to omitting it.
  await test("flag-off parity: context undefined === no context field", async () => {
    const undef = await detectAll(LYRIC, { ...baseCtx, context: undefined });
    assert.deepEqual(undef, off);
  });

  // Spoken context (built from a real prayer utterance) caps the song to <= 84.
  const engine = new ContextEngine();
  engine.observe({ text: "Lord Jesus Christ we thank you, you are worthy, you are holy", now: 1000 });
  const spokenSnap = engine.observe({ text: "in the mighty name of Jesus we pray", now: 4000 });
  await test("engine reports isSpokenContext for the prayer moment", async () => {
    assert.equal(spokenSnap.isSpokenContext, true);
  });
  await test("spoken context CAPS the song match to <= 84 (no zero-click)", async () => {
    const capped = await detectAll(LYRIC, { ...baseCtx, context: spokenSnap });
    assert.ok(topSong(capped) <= 84, `expected <=84, got ${topSong(capped)}`);
  });

  // A worship snapshot must NOT cap (real songs pass through).
  const wEngine = new ContextEngine();
  wEngine.observe({ text: "amazing grace how sweet the sound", now: 1000, signals: { musicSuspected: true, lyricMatchScore: 80 } });
  const worshipSnap = wEngine.observe({ text: "that saved a wretch like me", now: 4000, signals: { musicSuspected: true, lyricMatchScore: 82 } });
  await test("worship context does NOT cap the song (isSpokenContext false)", async () => {
    assert.equal(worshipSnap.isSpokenContext, false);
    const notCapped = await detectAll(LYRIC, { ...baseCtx, context: worshipSnap });
    assert.equal(topSong(notCapped), topSong(off), "worship must leave the song confidence untouched");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
main();
