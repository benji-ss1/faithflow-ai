/**
 * Lyric song search (operator Songs search bar + Cmd+K).
 *
 * Run: npx tsx test/song-lyric-search.test.ts
 */
import assert from "node:assert";
import { buildSongLyricIndex, createSongLyricIndexBuilder, searchSongLyrics, normaliseText, type LyricLibrarySong } from "../src/lib/song-lyric-search";

let passed = 0;
function t(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL ${name}`); throw e; }
}

const S = (songId: string, title: string, slides: string[], artist: string | null = null): LyricLibrarySong => ({
  songId, title, artist, slides: slides.map((lyrics, i) => ({ order: i, lyrics })),
});

const longSlides = Array.from({ length: 14 }, (_, i) => `filler verse number ${i} walking along the road`);
longSlides[11] = "Through the valley of the shadow\nYou lead me beside still waters";

const lib: LyricLibrarySong[] = [
  S("amazing", "Amazing Grace", [
    "Amazing grace how sweet the sound\nThat saved a wretch like me",
    "I once was lost but now am found\nWas blind but now I see",
  ], "John Newton"),
  S("great", "Great Is Thy Faithfulness", [
    "Great is Thy faithfulness O God my Father\nThere is no shadow of turning with Thee",
    "Morning by morning new mercies I see",
  ]),
  S("long", "Shepherd Song", longSlides),
  S("yoruba", "Ẹ Ṣé Baba", ["Ẹ ṣé baba\nẸ ṣé o, Olúwa", "A dúpẹ́ lọ́wọ́ rẹ"]),
  S("dont", "Don't Give Up", ["Don't give up on me Lord\nYou're my strength"]),
  S("repeat", "Holy Holy", ["holy holy holy", "holy holy holy", "Lord God almighty holy"]),
  S("phrase", "Almighty Lord", ["Lord God almighty we worship you forever"]),
  S("love1", "Your Love", ["Your love never fails"]),
  S("love2", "Reckless Love", ["Oh the overwhelming never ending reckless love of God"]),
  S("other", "Way Maker", ["Way maker miracle worker promise keeper\nLight in the darkness my God that is who you are"]),
  S("love3", "Jesus Paid It All", ["love lifted me when nothing else could help"]),
];
const idx = buildSongLyricIndex(lib);

t("exact chorus line ranks first", () => {
  const r = searchSongLyrics(idx, "light in the darkness my God");
  assert.equal(r[0].songId, "other");
  assert.match(r[0].matchedLine, /Light in the darkness/);
});

t("line from slide >= 10 gives correct slideOrder", () => {
  const r = searchSongLyrics(idx, "you lead me beside still waters");
  assert.equal(r[0].songId, "long");
  assert.equal(r[0].slideOrder, 11);
  assert.match(r[0].matchedLine, /beside still waters/);
});

t("partial last word", () => {
  const r = searchSongLyrics(idx, "morning by morning new merc");
  assert.equal(r[0].songId, "great");
  assert.equal(r[0].slideOrder, 1);
});

t("typo: amazng grace", () => {
  assert.equal(searchSongLyrics(idx, "amazng grace")[0].songId, "amazing");
});

t("typo: grate is thy faithfullness", () => {
  assert.equal(searchSongLyrics(idx, "grate is thy faithfullness")[0].songId, "great");
});

t("word order shuffled", () => {
  assert.equal(searchSongLyrics(idx, "wretch saved me like")[0].songId, "amazing");
});

t("punctuation/case", () => {
  assert.equal(searchSongLyrics(idx, "DON'T GIVE UP, on me!")[0].songId, "dont");
  assert.equal(searchSongLyrics(idx, "dont give up on me")[0].songId, "dont");
});

t("Yoruba with/without tone marks", () => {
  assert.equal(normaliseText("Ẹ ṣé baba"), "e se baba");
  assert.equal(searchSongLyrics(idx, "ẹ ṣé baba")[0].songId, "yoruba");
  assert.equal(searchSongLyrics(idx, "e se baba")[0].songId, "yoruba");
  assert.equal(searchSongLyrics(idx, "a dupe lowo re")[0].songId, "yoruba");
});

t("repeated phrase: contiguous phrase beats repeated single word", () => {
  const r = searchSongLyrics(idx, "lord god almighty we worship");
  assert.equal(r[0].songId, "phrase");
});

t("single common word ranks titles first and doesn't dump everything", () => {
  const r = searchSongLyrics(idx, "love", 3);
  assert.ok(r.length <= 3);
  assert.ok(["love1", "love2"].includes(r[0].songId), `got ${r[0].songId}`);
  assert.ok(r[0].titleMatch);
  const all = searchSongLyrics(idx, "love");
  const firstNonTitle = all.findIndex((h) => !h.titleMatch);
  if (firstNonTitle >= 0) assert.ok(all.slice(firstNonTitle).every((h) => !h.titleMatch));
});

t("title-like query ranks title first", () => {
  assert.equal(searchSongLyrics(idx, "way maker")[0].songId, "other");
  assert.equal(searchSongLyrics(idx, "great is thy")[0].songId, "great");
});

t("nonsense returns empty", () => {
  assert.deepEqual(searchSongLyrics(idx, "xqzvk plomtrb"), []);
  assert.deepEqual(searchSongLyrics(idx, "   "), []);
  assert.deepEqual(searchSongLyrics(null, "grace"), []);
});

t("performance: ~20k slides build < 1s, query < 20ms", () => {
  const words = "lord god jesus grace love mercy holy spirit praise worship king glory name power blood cross heaven light shine river fire rain faithful savior victory hallelujah amen forever mountain valley shepherd lamb throne crown kingdom joy peace hope strength rock refuge".split(" ");
  // mulberry32 — deterministic, no short cycles (duplicate lines would make the target ambiguous).
  let seed = 42;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  // Realistic vocabulary: common worship words (Zipf-heavy) + ~4k pseudo-words.
  const syl = "ba be bi bo bu da de di do ka ke ki ko la le li lo ma me mi mo na ne ni no ra re ri ro sa se si so ta te ti to wa we wi yo".split(" ");
  const rare = Array.from({ length: 4000 }, (_, i) => syl[i % syl.length] + syl[Math.floor(i / syl.length) % syl.length] + syl[(i * 7) % syl.length]);
  const pick = () => (rnd() < 0.35 ? words[Math.floor(rnd() * words.length)] : rare[Math.floor(rnd() * rare.length)]);
  const big: LyricLibrarySong[] = [];
  for (let s = 0; s < 2700; s++) {
    const slides = Array.from({ length: 7 + (s % 3) }, () =>
      Array.from({ length: 3 }, () => Array.from({ length: 7 }, pick).join(" ")).join("\n"));
    big.push(S(`s${s}`, `${pick()} ${pick()} ${s}`, slides));
  }
  const slideCount = big.reduce((n, s) => n + s.slides.length, 0);
  // Assert on process CPU time (single-threaded work), not wall clock: on a
  // loaded dev machine wall time is dominated by scheduling, not this code.
  const cpuMs = (c: NodeJS.CpuUsage) => (c.user + c.system) / 1000;
  const t0 = performance.now();
  const c0 = process.cpuUsage();
  const bigIdx = buildSongLyricIndex(big);
  const buildMs = cpuMs(process.cpuUsage(c0));
  const buildWall = performance.now() - t0;
  const target = big[1234].slides[5].lyrics.split("\n")[1];
  const queries = [target, "amazng grace hallelujah", "lord", "shepherd lamb throne crown", "kingdom of glo"];
  searchSongLyrics(bigIdx, "warmup query");
  let worst = 0;
  const timings: string[] = [];
  for (const q of queries) {
    // median of 5 runs — a single run is dominated by GC/JIT noise
    const runs: number[] = [];
    const walls: number[] = [];
    for (let k = 0; k < 5; k++) {
      const q0 = performance.now();
      const c1 = process.cpuUsage();
      searchSongLyrics(bigIdx, q);
      runs.push(cpuMs(process.cpuUsage(c1)));
      walls.push(performance.now() - q0);
    }
    const med = runs.sort((a, b) => a - b)[2];
    const wmed = walls.sort((a, b) => a - b)[2];
    timings.push(`${JSON.stringify(q.slice(0, 28))}=${med.toFixed(1)}ms cpu/${wmed.toFixed(1)}ms wall`);
    // cpu > wall ⇒ parallel GC threads counted; wall > cpu ⇒ OS scheduling on a
    // loaded box. The smaller of the two is the fair estimate of this code's cost.
    worst = Math.max(worst, Math.min(med, wmed));
  }
  console.log(`      per-query median: ${timings.join(", ")}`);
  console.log(`      perf: ${slideCount} slides, build ${buildMs.toFixed(0)}ms cpu (${buildWall.toFixed(0)}ms wall), worst query ${worst.toFixed(1)}ms (min of cpu/wall median)`);
  // Chunked (UI) build: no single synchronous step may exceed ~60ms.
  const builder = createSongLyricIndexBuilder(big, 500); // same batch size as song-lyric-search-store.ts
  let longest = 0; let steps = 0; let finished = false;
  while (!finished) {
    const s0 = performance.now(); const sc = process.cpuUsage();
    finished = builder.step(); steps++;
    const u = process.cpuUsage(sc);
    longest = Math.max(longest, Math.min(performance.now() - s0, (u.user + u.system) / 1000));
  }
  console.log(`      chunked build: ${steps} steps, longest chunk ${longest.toFixed(1)}ms`);
  assert.ok(longest < 60, `longest chunk ${longest}ms`);
  assert.equal(builder.index!.size, bigIdx.size);
  // Query p95 across 40 lyric-line queries.
  const lat: number[] = [];
  for (let k = 0; k < 40; k++) {
    const song = big[(k * 67) % big.length];
    const q = song.slides[k % song.slides.length].lyrics.split("\n")[k % 3];
    const q0 = performance.now(); searchSongLyrics(bigIdx, q); lat.push(performance.now() - q0);
  }
  lat.sort((a, b) => a - b);
  console.log(`      query p95 ${lat[Math.floor(lat.length * 0.95)].toFixed(1)}ms (n=40)`);
  const hit = searchSongLyrics(bigIdx, target);
  assert.ok(hit.slice(0, 3).some((h) => h.songId === "s1234"), "synthetic target in top 3");
  assert.ok(buildMs < 1000, `build ${buildMs}ms`);
  assert.ok(worst < 20, `query ${worst}ms`);
});

// Store: a failed fallback fetch must not leave "Indexing lyrics…" stuck; a later
// successful fetch (after the 30s backoff) builds the index.
async function storeFetchFailureRecovers() {
  const store = await import("../src/lib/song-lyric-search-store");
  const t0 = 1_000_000;
  await store.requestSongLibrary(async () => ({ ok: false, json: async () => ({}) }), t0);
  let st = store.__lyricStoreStatus();
  assert.equal(st.fetchFailed, true);
  assert.equal(st.indexing, false, "failed fetch must not show indexing");
  assert.deepEqual(store.__lyricStoreSearch("amazing grace"), []);

  // Within the backoff window: no retry.
  let calls = 0;
  await store.requestSongLibrary(async () => { calls++; return { ok: true, json: async () => ({ songs: lib }) }; }, t0 + 5_000);
  assert.equal(calls, 0, "no retry inside 30s backoff");

  // After the window: retry succeeds and the idle build completes.
  await store.requestSongLibrary(async () => { calls++; return { ok: true, json: async () => ({ songs: lib }) }; }, t0 + 31_000);
  assert.equal(calls, 1);
  const deadline = Date.now() + 5000;
  while (!store.__lyricStoreStatus().ready && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  st = store.__lyricStoreStatus();
  assert.equal(st.ready, true, "index built after successful retry");
  assert.equal(st.indexing, false);
  assert.equal(st.fetchFailed, false);
  assert.equal(store.__lyricStoreSearch("amazing grace")[0]?.songId, "amazing");
}

storeFetchFailureRecovers()
  .then(() => { passed++; console.log("  ok  store: failed fetch → no indexing hint; retry after backoff builds index"); console.log(`\nsong-lyric-search: ${passed} passed`); })
  .catch((e) => { console.error("  FAIL store: failed fetch recovery"); console.error(e); process.exit(1); });
