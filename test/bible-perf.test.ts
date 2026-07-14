/**
 * Perf/confidence tests for the Bible + AI-detection pipeline.
 * Run: npx tsx test/bible-perf.test.ts
 *
 * Covers:
 *   - Client-side Bible lookup cache (hit / miss / capacity)
 *   - Server-side Bible cache primitives
 *   - Confidence blending: scripture parser × Deepgram utterance confidence
 *   - Song lyric-fragment matching layer
 */
import assert from "node:assert/strict";
import { bibleCacheKey, getBibleCached, setBibleCached, _clearBibleClientCache, _bibleClientCacheSize } from "../src/lib/bible-client-cache";
import { cacheKey, getCached, setCached, _clearCache, _cacheSize } from "../src/lib/server/bible-cache";
import { buildIndex, matchLyricFragment } from "../src/lib/ai-detection/lyric-fragment";

let passed = 0, failed = 0;
function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => { console.log(`  PASS  ${name}`); passed++; })
    .catch((e) => { console.error(`  FAIL  ${name}\n         ${(e as Error).message}`); failed++; });
}

async function main() {
  // --- Client cache ---------------------------------------------------------
  _clearBibleClientCache();
  await test("client cache: miss returns null", () => {
    const k = bibleCacheKey("KJV", "John", 3, 16, 16);
    assert.equal(getBibleCached(k), null);
  });
  await test("client cache: set then get returns entry", () => {
    const k = bibleCacheKey("KJV", "John", 3, 16, 16);
    setBibleCached(k, [{ verse: 16, text: "For God so loved..." }], "KJV");
    const hit = getBibleCached(k);
    assert.ok(hit);
    assert.equal(hit!.verses[0].text, "For God so loved...");
    assert.equal(hit!.translation, "KJV");
  });
  await test("client cache: keys are case-insensitive for book + translation", () => {
    const a = bibleCacheKey("KJV", "John", 3, 16, 16);
    const b = bibleCacheKey("kjv", "john", 3, 16, 16);
    assert.equal(a, b);
  });
  await test("client cache: chapterEnd distinguishes cross-chapter keys", () => {
    const single = bibleCacheKey("KJV", "Colossians", 3, 20, 2);
    const cross = bibleCacheKey("KJV", "Colossians", 3, 20, 2, 4);
    assert.notEqual(single, cross);
  });

  // --- Server cache ---------------------------------------------------------
  _clearCache();
  await test("server cache: set/get round-trip", () => {
    const k = cacheKey("KJV", "Psalms", 23, 1, 6);
    setCached(k, [
      { id: "1", book: "Psalms", bookOrder: 19, chapter: 23, verse: 1, text: "The Lord is my shepherd..." },
    ]);
    const hit = getCached(k);
    assert.ok(hit);
    assert.equal(hit![0].verse, 1);
  });
  await test("server cache: size counter increments", () => {
    const start = _cacheSize();
    setCached(cacheKey("KJV", "Job", 1, 1, 1), [
      { id: "j", book: "Job", bookOrder: 18, chapter: 1, verse: 1, text: "There was a man..." },
    ]);
    assert.ok(_cacheSize() > start);
  });

  // --- Confidence blending (scripture) --------------------------------------
  // Mirrors the client-side formula in useAudioStream.runDetectAll:
  //   blend(parser, dg) = round(parser * dg) clamped [1..100]
  const blendScripture = (parserConf: number, dg?: number): number => {
    if (typeof dg !== "number" || dg <= 0 || dg > 1) return Math.round(parserConf);
    return Math.max(1, Math.min(100, Math.round(parserConf * dg)));
  };
  await test("confidence: parser=95, dg=1.0 → 95", () => {
    assert.equal(blendScripture(95, 1.0), 95);
  });
  await test("confidence: parser=95, dg=0.8 → 76", () => {
    assert.equal(blendScripture(95, 0.8), 76);
  });
  await test("confidence: parser=95, dg=0.5 → 48 (amber tier)", () => {
    assert.equal(blendScripture(95, 0.5), 48);
  });
  await test("confidence: missing dg leaves parser conf untouched", () => {
    assert.equal(blendScripture(92, undefined), 92);
  });
  await test("confidence: out-of-range dg (>1) treated as missing", () => {
    assert.equal(blendScripture(80, 1.5), 80);
  });
  await test("confidence: clamps to >=1 when dg provided (blend is meaningful)", () => {
    // With dg provided, output is clamped to at least 1 so a fully-detected
    // ref with awful audio still shows a nonzero pill instead of "0%".
    assert.equal(blendScripture(0, 0.5), 1);
  });

  // --- Lyric fragment matching ----------------------------------------------
  const library = [
    { songId: "s1", title: "Amazing Grace", source: "public_domain" as const, slides: [
      { order: 0, lyrics: "Amazing grace how sweet the sound\nThat saved a wretch like me" },
      { order: 1, lyrics: "I once was lost but now am found\nWas blind but now I see" },
    ]},
    { songId: "s2", title: "How Great Thou Art", source: "public_domain" as const, slides: [
      { order: 0, lyrics: "Then sings my soul my Saviour God to Thee\nHow great Thou art how great Thou art" },
    ]},
  ];
  const idx = buildIndex(library);
  await test("lyric fragment: matches spoken chunk against indexed lyrics", () => {
    const hits = matchLyricFragment("that saved a wretch like me tonight", idx);
    assert.ok(hits.length > 0, "expected at least one lyric hit");
    assert.equal(hits[0].songId, "s1");
    assert.ok(hits[0].score > 0);
  });
  await test("lyric fragment: unrelated speech returns no hits", () => {
    const hits = matchLyricFragment("please take your seats and open your bulletins", idx);
    assert.equal(hits.length, 0);
  });
  await test("lyric fragment: too-short chunk returns no hits (minWords=4)", () => {
    const hits = matchLyricFragment("great thou", idx);
    assert.equal(hits.length, 0);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
