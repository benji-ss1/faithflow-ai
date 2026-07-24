/**
 * Pass 2 accuracy audit — static, text-only.
 *
 * Fable-audit scenarios: overlapping instruments, off-mic vocalist,
 * accented speaker, repeated chorus, skipped verse, spoken ad-lib
 * mid-song. Since we cannot run audio through the real Deepgram bridge
 * from a shell test, each scenario is modelled as a PLAUSIBLE
 * transcript that Deepgram would emit under those conditions, then run
 * through detectAll() — the same code path the production bridge uses.
 *
 * Metrics reported (deterministic, per-run):
 *   - MATCH RATE: fraction of scenarios where the intended detection
 *     landed (song OR scripture as expected).
 *   - FALSE-TRIGGER RATE: fraction of "negative" scenarios (ambient
 *     speech containing no ref/song) that DID produce a suggestion
 *     above the auto-project floor (85%).
 *   - SILENT-FAILURE RATE: fraction of positive scenarios where NO
 *     suggestion was produced at all (worst UX — operator has no
 *     signal to act on).
 *
 * NOT MEASURED (out of scope for static tests, would need audio rig):
 *   - Word error rate (WER) — requires audio fixtures + real Deepgram
 *   - Interim vs final timing — requires live bridge
 *   - Real accented / off-mic / instrument-bleed conditions — same
 *
 * Run: npx tsx test/adversarial/accuracy-pass2.test.ts
 */
import { detectAll } from "../../src/lib/ai-detection";
import type { IndexedSong } from "../../src/lib/ai-detection/lyric-fragment";

const library: IndexedSong[] = [
  {
    songId: "song-ag",
    title: "Amazing Grace",
    artist: "John Newton",
    source: "public_domain",
    slides: [
      { order: 1, lyrics: "Amazing grace how sweet the sound\nThat saved a wretch like me" },
      { order: 2, lyrics: "I once was lost but now am found\nWas blind but now I see" },
      { order: 3, lyrics: "Through many dangers toils and snares\nI have already come" },
      { order: 4, lyrics: "Twas grace that brought me safe thus far\nAnd grace will lead me home" },
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
  {
    songId: "song-htg",
    title: "How Great Thou Art",
    artist: "Stuart K. Hine",
    source: "public_domain",
    slides: [
      { order: 1, lyrics: "O Lord my God when I in awesome wonder\nConsider all the worlds thy hands have made" },
      { order: 2, lyrics: "Then sings my soul my saviour God to thee\nHow great thou art how great thou art" },
    ],
  },
];

const ctx = {
  churchId: "c1", planSongIds: [], recentSongIds: [], library,
  hasVerseContext: false, hasSlideContext: true, hasSongContext: true,
};

const AUTO_LIVE_CONFIDENCE = 85; // matches SONG_AUTOLIVE_CONFIDENCE prod constant

type ScenarioResult = {
  name: string;
  kind: "positive" | "negative";
  transcript: string;
  expected?: { type: "song" | "scripture"; targetId?: string; book?: string };
  detected: { song: string[]; scripture: string[]; conf: number };
  matched: boolean;
  falseTrigger: boolean; // negative case fired above auto-live floor
  silentFailure: boolean; // positive case, no suggestion at all
};

async function run(name: string, kind: "positive" | "negative", transcript: string, expected?: ScenarioResult["expected"]): Promise<ScenarioResult> {
  const r = await detectAll(transcript, ctx);
  const songMatches = [...r.song, ...r.lyric];
  const songIds = songMatches.map((s) => s.songId).filter((id): id is string => typeof id === "string");
  const scriptureRefs = r.scripture.map((s) => `${s.book} ${s.chapter}:${s.verseStart}`);
  const topConf = Math.max(
    0,
    ...songMatches.map((s) => s.confidence),
    ...r.scripture.map((s) => s.confidence),
  );
  const anySuggestion = songMatches.length > 0 || scriptureRefs.length > 0;
  let matched = false;
  if (expected?.type === "song" && expected.targetId) {
    matched = songIds.includes(expected.targetId);
  } else if (expected?.type === "scripture" && expected.book) {
    matched = r.scripture.some((s) => s.book === expected.book);
  }
  return {
    name, kind, transcript, expected,
    detected: { song: songIds, scripture: scriptureRefs, conf: Math.round(topConf) },
    matched,
    falseTrigger: kind === "negative" && anySuggestion && topConf >= AUTO_LIVE_CONFIDENCE,
    silentFailure: kind === "positive" && !anySuggestion,
  };
}

async function main() {
  const results: ScenarioResult[] = [];

  // ===== POSITIVE scenarios — should detect =====

  // 1. Clean scripture reference
  results.push(await run("clean-scripture", "positive",
    "Turn with me to John chapter three verse sixteen",
    { type: "scripture", book: "John" }));

  // 2. TH-fronting accent (tird → third, tree → three)
  results.push(await run("accented-scripture-th-fronting", "positive",
    "let us read John tree sixteen for God so loved the world",
    { type: "scripture", book: "John" }));

  // 3. Numbered book with accent (Habakkuk hard-to-transcribe)
  results.push(await run("hard-book-name", "positive",
    "turn to Habakkuk two verse four",
    { type: "scripture", book: "Habakkuk" }));

  // 4. Multiple scripture in one segment (back-to-back cites)
  results.push(await run("consecutive-scripture", "positive",
    "read John 3:16 and Romans 8:28",
    { type: "scripture", book: "John" }));

  // 5. Clean song by content (no wake phrase)
  results.push(await run("song-by-lyric-only", "positive",
    "amazing grace how sweet the sound that saved a wretch like me",
    { type: "song", targetId: "song-ag" }));

  // 6. Song with wake phrase
  results.push(await run("song-with-wake", "positive",
    "let us sing amazing grace",
    { type: "song", targetId: "song-ag" }));

  // 7. Song with repeated chorus (should still resolve, not confuse)
  results.push(await run("repeated-chorus", "positive",
    "what a god what a god what a god we serve what a god what a god",
    { type: "song", targetId: "song-wag" }));

  // 8. Skipped verse (jumps from verse 1 to verse 3 content)
  results.push(await run("skipped-verse", "positive",
    "through many dangers toils and snares I have already come",
    { type: "song", targetId: "song-ag" }));

  // 9. Off-mic simulation — partial words, low-signal transcript
  //    (Deepgram tends to emit fragments; we model that.)
  results.push(await run("off-mic-partial", "positive",
    "amazing grace how ... sound",
    { type: "song", targetId: "song-ag" }));

  // 10. Mid-song ad-lib ("y'all sing it with me now")
  results.push(await run("mid-song-adlib", "positive",
    "yall sing it with me now amazing grace how sweet the sound",
    { type: "song", targetId: "song-ag" }));

  // 11. Overlapping-instruments simulation — extra ambient words
  results.push(await run("instrument-bleed-words", "positive",
    "drums cymbal snare amazing grace how sweet the sound bass",
    { type: "song", targetId: "song-ag" }));

  // 12. Accented book fuzzy match (filippians instead of Philippians)
  results.push(await run("fuzzy-book-name", "positive",
    "let us turn to filippians four verse thirteen",
    { type: "scripture", book: "Philippians" }));

  // ===== NEGATIVE scenarios — should NOT auto-fire =====

  // 13. Preacher small-talk (no ref, no lyric)
  results.push(await run("neg-smalltalk", "negative",
    "welcome everyone what a wonderful morning we have today"));

  // 14. Coincidental words that overlap with lyric fragments
  results.push(await run("neg-lyric-fragment", "negative",
    "grace to you brothers and sisters"));

  // 15. Number-heavy speech that could false-match a reference
  results.push(await run("neg-number-heavy", "negative",
    "we have three services today at nine ten and eleven"));

  // 16. Song title in a sentence (not a sing-command, no lyrics)
  results.push(await run("neg-title-mention", "negative",
    "next week's theme is amazing grace and we hope you'll join us"));

  // 17. Pure gibberish
  results.push(await run("neg-gibberish", "negative",
    "the quick brown fox jumps over the lazy dog for no reason"));

  // ===== REPORT =====
  console.log("\n=== Pass 2 accuracy audit ===\n");
  for (const r of results) {
    const status = r.kind === "positive"
      ? (r.silentFailure ? "SILENT-FAIL" : r.matched ? "OK" : "MISS")
      : (r.falseTrigger ? "FALSE-TRIGGER" : "OK");
    const mark = status === "OK" ? "✓" : "✗";
    console.log(`  ${mark} [${r.kind}] ${r.name} → ${status} (conf ${r.detected.conf}%, song ${JSON.stringify(r.detected.song)}, scripture ${JSON.stringify(r.detected.scripture)})`);
  }

  const positives = results.filter((r) => r.kind === "positive");
  const negatives = results.filter((r) => r.kind === "negative");
  const posMatched = positives.filter((r) => r.matched).length;
  const posSilent = positives.filter((r) => r.silentFailure).length;
  const negFalse = negatives.filter((r) => r.falseTrigger).length;

  console.log("\n--- Metrics ---");
  console.log(`Match rate:          ${posMatched}/${positives.length} = ${Math.round(100 * posMatched / positives.length)}%`);
  console.log(`Silent-failure rate: ${posSilent}/${positives.length} = ${Math.round(100 * posSilent / positives.length)}%`);
  console.log(`False-trigger rate:  ${negFalse}/${negatives.length} = ${Math.round(100 * negFalse / negatives.length)}%`);
  console.log(`Auto-live floor:     ${AUTO_LIVE_CONFIDENCE}%`);
  console.log("\nNOT MEASURED: WER, real accent audio, real instrument bleed, interim-timing. Needs live rig.");
}

main().catch((e) => { console.error(e); process.exit(1); });
