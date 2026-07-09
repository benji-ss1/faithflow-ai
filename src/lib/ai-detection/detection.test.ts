// Phase 5A detection tests. Run: npx tsx src/lib/ai-detection/detection.test.ts
import { detectAll, SuggestionDedupe } from "./index";
import type { IndexedSong } from "./lyric-fragment";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.log(`  FAIL ${name}`, extra ?? ""); }
}

const library: IndexedSong[] = [
  {
    songId: "song-ag",
    title: "Amazing Grace",
    artist: "John Newton",
    source: "public_domain",
    slides: [
      { order: 1, lyrics: "Amazing grace how sweet the sound\nThat saved a wretch like me" },
      { order: 2, lyrics: "I once was lost but now am found\nWas blind but now I see" },
    ],
  },
  {
    songId: "song-wag",
    title: "What A God",
    artist: "Unknown",
    source: "church",
    slides: [
      { order: 1, lyrics: "What a God what a God what a God we serve\nHe is worthy of our praise" },
    ],
  },
];

const ctx = {
  churchId: "c1",
  planSongIds: [] as string[],
  recentSongIds: [] as string[],
  library,
  hasVerseContext: false,
  hasSlideContext: true,
  hasSongContext: true,
};

async function main() {
  // 1. "John 3:16" → scripture hit
  const r1 = await detectAll("John 3:16 for God so loved the world", ctx);
  ok('scripture: "John 3:16"', r1.scripture.some((s) => s.book === "John" && s.chapter === 3 && s.verseStart === 16), r1.scripture);

  // 2. "John chapter three verse sixteen" → scripture hit
  const r2 = await detectAll("Let's turn to John chapter three verse sixteen", ctx);
  ok('scripture: spoken form', r2.scripture.some((s) => s.book === "John" && s.chapter === 3 && s.verseStart === 16), r2.scripture);

  // 3. "Let's sing Amazing Grace" → cue + candidateTitle
  const r3 = await detectAll("Let's sing Amazing Grace together", ctx);
  ok('cue: "let\'s sing" fires', r3.cue.length > 0);
  ok('cue: candidateTitle is Amazing Grace-ish', r3.cue.some((c) => /amazing\s+grace/i.test(c.candidateTitle)), r3.cue);
  ok('song match: Amazing Grace resolved', r3.song.some((s) => s.songId === "song-ag"), r3.song);

  // 4. "go to the chorus" → section command
  const r4 = await detectAll("okay go to the chorus", ctx);
  ok('section command: chorus', r4.section.some((s) => s.section === "chorus"), r4.section);

  // 5. Dedupe: same phrase 5x should only emit once
  const dd = new SuggestionDedupe(30_000);
  const key = "what a god";
  const outs: string[] = [];
  for (let i = 0; i < 5; i++) outs.push(dd.shouldEmit("lyric", key, 70, 1000 + i * 100));
  ok('dedupe: first is new, rest suppressed', outs[0] === "new" && outs.slice(1).every((o) => o === "suppress"), outs);
  // Refresh when confidence rises >= 10
  ok('dedupe: refresh on +10 confidence', dd.shouldEmit("lyric", key, 82, 1600) === "refresh");
  // New window after cooldown
  ok('dedupe: new after cooldown', dd.shouldEmit("lyric", key, 82, 1600 + 30_001) === "new");

  // 6. "some random lyric" → no unsafe match
  const r6 = await detectAll("some random lyric that no song contains at all", ctx);
  const unsafe = [...r6.lyric, ...r6.song].filter((x) => x.confidence >= 70);
  ok('safety: no high-confidence match for gibberish', unsafe.length === 0, unsafe);

  // 7. Safety: song with no lyrics is never returned
  const brokenLib: IndexedSong[] = [{ songId: "empty", title: "Amazing Grace", artist: null, source: "church", slides: [{ order: 1, lyrics: "" }] }];
  const r7 = await detectAll("let's sing Amazing Grace", { ...ctx, library: brokenLib });
  ok('safety: empty-lyrics song rejected', r7.song.length === 0 && r7.lyric.length === 0, { song: r7.song, lyric: r7.lyric });

  console.log(`\n${passed} passed · ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
