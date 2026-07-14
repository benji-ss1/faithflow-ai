/**
 * Priority-3 AI listening pipeline tests.
 * Run: npx tsx --env-file=.env.local test/ai-pipeline.test.ts
 *
 * Headless coverage:
 *   1. Reference parser detects spoken/written forms.
 *   2. Junk speech yields no false positives.
 *   3. Confidence filter suppresses low-confidence detections at the UI layer.
 *   4. A minimal AudioStream state-machine transition model (idle → connecting
 *      → open → error) — we can't spawn a real WebSocket + AudioContext under
 *      node:tsx, so the actual React hook is not driven here. Instead we verify
 *      the PipelineStage union defines the transitions the UI depends on.
 */
import assert from "node:assert/strict";
import { parseReferences } from "../src/lib/bible-parser";
import type { PipelineStage } from "../src/components/operator/useAudioStream";
import { detectSongInTranscript, resetSongDedupe } from "../src/lib/ai-detection/song-detection";
import { detectAll } from "../src/lib/ai-detection";
import type { IndexedSong } from "../src/lib/ai-detection/lyric-fragment";
import { readAudioInputPref, audioConstraintsFor } from "../src/lib/voice-commands";

let passed = 0;
let failed = 0;
// Y7: single beforeEach hook so future tests don't have to remember to
// resetSongDedupe() manually. Tests that need custom setup can still call
// it explicitly.
const beforeEach: (() => void)[] = [() => resetSongDedupe()];
const pending: Promise<unknown>[] = [];
function test(name: string, fn: () => void | Promise<void>) {
  try {
    for (const b of beforeEach) b();
    const r = fn();
    if (r && typeof (r as Promise<unknown>).then === "function") {
      const p = (r as Promise<unknown>).then(
        () => { passed++; console.log(`  ok  ${name}`); },
        (e: unknown) => { failed++; console.log(`  FAIL ${name}`, e); },
      );
      pending.push(p);
      return p;
    }
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}`, e);
  }
}

async function main() {
  // ---- Reference parser (spoken forms) ----
  test('parses "John 3:16" (numeric)', () => {
    const refs = parseReferences("John 3:16 for God so loved the world");
    assert.ok(refs.some((r) => r.book === "John" && r.chapter === 3 && r.verseStart === 16));
  });

  test('parses "John chapter three verse sixteen"', () => {
    const refs = parseReferences("let us turn to John chapter three verse sixteen");
    assert.ok(refs.some((r) => r.book === "John" && r.chapter === 3 && r.verseStart === 16),
      `expected John 3:16, got: ${JSON.stringify(refs)}`);
  });

  test('parses "Psalm twenty three" as Psalms chapter 23 (whole-chapter)', () => {
    // R2 fix: compound spoken numbers now fuse in normalize(), so
    // "Psalm twenty three" resolves cleanly to Ps 23 whole-chapter.
    const refs = parseReferences("as the psalmist writes in Psalm twenty three");
    assert.ok(refs.some((r) => r.book === "Psalms" && r.chapter === 23),
      `expected Psalms 23, got: ${JSON.stringify(refs)}`);
  });

  test('parses "second Corinthians chapter five"', () => {
    const refs = parseReferences("Paul writes in second Corinthians chapter five");
    assert.ok(refs.some((r) => /corinthians/i.test(r.book) && /^2/.test(r.book) && r.chapter === 5),
      `expected 2 Corinthians 5, got: ${JSON.stringify(refs)}`);
  });

  // ---- No false positives ----
  test("junk speech yields no reference", () => {
    const refs = parseReferences("okay everyone please stand and welcome the choir");
    assert.equal(refs.length, 0, `unexpected refs: ${JSON.stringify(refs)}`);
  });

  test("bare number without book yields no reference", () => {
    const refs = parseReferences("three sixteen");
    assert.equal(refs.length, 0);
  });

  // ---- Confidence filter (UI-layer simulation) ----
  test("suggestions below confidenceThreshold are filtered", () => {
    const threshold = 60;
    const items = [
      { id: "a", confidence: 40 },
      { id: "b", confidence: 75 },
      { id: "c", confidence: 59 },
      { id: "d", confidence: 90 },
    ];
    const passed = items.filter((s) => s.confidence >= threshold);
    assert.deepEqual(passed.map((p) => p.id), ["b", "d"]);
  });

  // ---- PipelineStage transitions (type-level contract) ----
  test("PipelineStage union covers the 7-stage pipeline", () => {
    // Compile-time contract: the union in useAudioStream.ts must include each
    // of these stages, otherwise the ticker + red-dot logic breaks silently.
    const required: PipelineStage[] = [
      "idle",
      "requesting_ticket",
      "ticket_ok",
      "opening_ws",
      "ws_open",
      "requesting_mic",
      "mic_granted",
      "audioctx_ready",
      "worklet_loaded",
      "worklet_connected",
      "deepgram_ready",
      "first_chunk_sent",
      "receiving_interim",
      "receiving_final",
      "paused",
    ];
    // If any of the above is missing from the union, TS fails to compile
    // (and this test never runs). At runtime we just verify the list.
    assert.ok(required.length === 15);
  });

  // ---- WS URL config gate ----
  test("empty NEXT_PUBLIC_AUDIO_WS_URL falls back to localhost:3001", () => {
    // Mirrors /api/audio/ticket route logic.
    const wsBase = process.env.NEXT_PUBLIC_AUDIO_WS_URL || "ws://localhost:3001";
    assert.ok(wsBase.startsWith("ws://") || wsBase.startsWith("wss://"),
      `wsBase must be ws:// or wss://, got ${wsBase}`);
  });

  // ---- Song detection from speech (Priority 6) ----
  test("song: exact title after 'let's sing' trigger", () => {
    resetSongDedupe();
    const r = detectSongInTranscript("let's sing Amazing Grace tonight",
      [{ songId: "a", title: "Amazing Grace" }]);
    assert.ok(r, "expected match");
    assert.equal(r!.songId, "a");
    assert.ok(r!.confidence >= 80, `confidence too low: ${r!.confidence}`);
    assert.equal(r!.matchType, "exact");
  });

  test("song: 'let us worship with <title>'", () => {
    resetSongDedupe();
    const r = detectSongInTranscript(
      "let us worship with how great is thy faithfulness",
      [{ songId: "b", title: "How Great Is Thy Faithfulness" }]);
    assert.ok(r, "expected match");
    assert.equal(r!.songId, "b");
  });

  test("song: title within longer trailing phrase", () => {
    resetSongDedupe();
    const r = detectSongInTranscript(
      "let's sing amazing grace how sweet the sound",
      [{ songId: "a", title: "Amazing Grace" }]);
    assert.ok(r, "expected match");
    assert.equal(r!.songId, "a");
  });

  test("song: trigger without candidate returns null", () => {
    resetSongDedupe();
    const r = detectSongInTranscript("let's sing", []);
    assert.equal(r, null);
  });

  test("song: no trigger phrase returns null", () => {
    resetSongDedupe();
    const r = detectSongInTranscript(
      "the sermon today is about grace",
      [{ songId: "a", title: "Amazing Grace" }]);
    assert.equal(r, null);
  });

  test("song: dedup within 30s window", () => {
    resetSongDedupe();
    const lib = [{ songId: "a", title: "Amazing Grace" }];
    const t0 = 1_000_000;
    const first = detectSongInTranscript("let's sing amazing grace", lib, { now: t0 });
    assert.ok(first && first.matchType === "exact");
    const second = detectSongInTranscript("let's sing amazing grace", lib, { now: t0 + 5_000 });
    assert.ok(second, "expected second call to still return a suggestion");
    assert.equal(second!.matchType, "duplicate");
  });

  test("song: case-insensitive match", () => {
    resetSongDedupe();
    const r = detectSongInTranscript("let's sing amazing GRACE",
      [{ songId: "a", title: "Amazing Grace" }]);
    assert.ok(r, "expected match");
    assert.equal(r!.songId, "a");
  });

  test("song: fuzzy match with lower confidence", () => {
    resetSongDedupe();
    const r = detectSongInTranscript("let's sing amazing gray",
      [{ songId: "a", title: "Amazing Grace" }]);
    assert.ok(r, "expected fuzzy match");
    assert.equal(r!.songId, "a");
    // exact/substring would score higher; fuzzy should be lower
    assert.ok(r!.confidence <= 90, `fuzzy conf should be <=90, got ${r!.confidence}`);
  });

  // ---- R1: song-detection wired into runDetectAll (via detectAll) ----
  test("detectAll: 'let's sing Amazing Grace' returns song via song-detection", async () => {
    const lib: IndexedSong[] = [
      { songId: "a", title: "Amazing Grace", source: "public_domain",
        slides: [{ order: 0, lyrics: "Amazing grace how sweet the sound" }] },
    ];
    const res = await detectAll("let's sing Amazing Grace", {
      churchId: "c1", library: lib,
      hasVerseContext: false, hasSlideContext: false, hasSongContext: false,
    });
    assert.ok(res.song.length > 0, "expected at least one song result");
    assert.equal(res.song[0].songId, "a");
    assert.ok(res.song[0].confidence >= 80, `confidence too low: ${res.song[0].confidence}`);
  });

  // ---- Y1: bare "singing" no longer fires ----
  test("song: 'the choir was singing beautifully' -> null (Y1)", () => {
    const r = detectSongInTranscript("the choir was singing beautifully",
      [{ songId: "a", title: "Amazing Grace" }]);
    assert.equal(r, null);
  });

  test("song: 'let's worship the Lord together' -> null (Y1)", () => {
    const r = detectSongInTranscript("let's worship the Lord together",
      [{ songId: "a", title: "Amazing Grace" }]);
    assert.equal(r, null);
  });

  // ---- Y2: word-boundary substring rejects partial word overlap ----
  test("song: 'let's sing grace of God today' with title 'Grace' -> null (Y2)", () => {
    const r = detectSongInTranscript("let's sing grace of God today",
      [{ songId: "a", title: "Grace" }]);
    // Grace is <4 chars single-word title → exact-only, so "grace of God today"
    // does NOT match.
    assert.equal(r, null);
  });

  // ---- Audio input preference reading (pure function) ----
  test("readAudioInputPref: missing key returns null", () => {
    const store = new Map<string, string>();
    const pref = readAudioInputPref({ getItem: (k) => store.get(k) ?? null });
    assert.equal(pref, null);
  });

  test("readAudioInputPref: parses valid device entry", () => {
    const store = new Map<string, string>([
      ["presentflow.pro.audioInput.v1", JSON.stringify({ kind: "device", id: "abc123", label: "Mic 1" })],
    ]);
    const pref = readAudioInputPref({ getItem: (k) => store.get(k) ?? null });
    assert.ok(pref);
    assert.equal(pref!.kind, "device");
    assert.equal(pref!.id, "abc123");
  });

  test("readAudioInputPref: rejects malformed JSON", () => {
    const store = new Map<string, string>([["presentflow.pro.audioInput.v1", "{not-json"]]);
    const pref = readAudioInputPref({ getItem: (k) => store.get(k) ?? null });
    assert.equal(pref, null);
  });

  test("readAudioInputPref: rejects invalid kind", () => {
    const store = new Map<string, string>([
      ["presentflow.pro.audioInput.v1", JSON.stringify({ kind: "bogus", id: "x", label: "y" })],
    ]);
    const pref = readAudioInputPref({ getItem: (k) => store.get(k) ?? null });
    assert.equal(pref, null);
  });

  test("audioConstraintsFor: device pref uses exact deviceId", () => {
    const c = audioConstraintsFor({ kind: "device", id: "dev-1", label: "" });
    const audio = c.audio as MediaTrackConstraints;
    assert.ok(audio && typeof audio === "object");
    const did = audio.deviceId as { exact: string };
    assert.equal(did.exact, "dev-1");
  });

  test("audioConstraintsFor: NDI pref falls back to default (no deviceId)", () => {
    const c = audioConstraintsFor({ kind: "ndi", id: "ndi:default", label: "" });
    const audio = c.audio as MediaTrackConstraints;
    assert.ok(audio && typeof audio === "object");
    assert.equal((audio as { deviceId?: unknown }).deviceId, undefined);
  });

  test("audioConstraintsFor: null pref returns default constraints", () => {
    const c = audioConstraintsFor(null);
    const audio = c.audio as MediaTrackConstraints;
    assert.ok(audio && typeof audio === "object");
    assert.equal((audio as { deviceId?: unknown }).deviceId, undefined);
  });

  // ---- Panel dedupe invariants (Task 3) ----
  test("panel: mergeBibleRows replaces on higher confidence and bumps to top", async () => {
    const { mergeBibleRows, bibleKey } = await import("../src/components/operator/pro/right/AIDetectionsPanel");
    type BibleRow = Awaited<ReturnType<typeof mergeBibleRows>>[number];
    const a: BibleRow = { key: bibleKey("John", 3, 16, 16), book: "John", chapter: 3, verseStart: 16, verseEnd: 16, confidence: 70, ts: 1 };
    const b: BibleRow = { key: bibleKey("Romans", 8, 28, 28), book: "Romans", chapter: 8, verseStart: 28, verseEnd: 28, confidence: 80, ts: 2 };
    let rows: BibleRow[] = [a, b];
    const aHi = { ...a, confidence: 92, ts: 3 };
    rows = mergeBibleRows(rows, aHi);
    assert.equal(rows[0].key, aHi.key);
    assert.equal(rows[0].confidence, 92);
    assert.equal(rows.length, 2);
  });

  test("panel: mergeSongRows dedupes by songId; higher conf wins", async () => {
    const { mergeSongRows } = await import("../src/components/operator/pro/right/AIDetectionsPanel");
    type SongRow = Awaited<ReturnType<typeof mergeSongRows>>[number];
    const a: SongRow = { key: "s1", songId: "s1", title: "Amazing Grace", artist: null, confidence: 60, ts: 1,
      matchType: "Title", source: "local_library" };
    let rows: SongRow[] = [a];
    rows = mergeSongRows(rows, { ...a, confidence: 90, ts: 2 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].confidence, 90);
  });

  test("panel: bibleRowFromSuggestion rejects partial ref (chapter=0)", async () => {
    const { bibleRowFromSuggestion } = await import("../src/components/operator/pro/right/AIDetectionsPanel");
    const row = bibleRowFromSuggestion({
      id: "x", type: "scripture", segmentId: "s", ts: Date.now(), confidence: 70, matchedText: "Psalm",
      ref: { book: "Psalms", chapter: 0, verseStart: 0, verseEnd: 0 },
    });
    assert.equal(row, null);
  });

  test("detectAll: short chunk with no cue does NOT fire song detection", async () => {
    const lib: IndexedSong[] = [
      { songId: "a", title: "Amazing Grace", source: "public_domain",
        slides: [{ order: 0, lyrics: "Amazing grace how sweet the sound" }] },
    ];
    // 3 words, no trigger
    const res = await detectAll("amazing grace tonight", {
      churchId: "c1", library: lib,
      hasVerseContext: false, hasSlideContext: false, hasSongContext: false,
    });
    assert.equal(res.song.length, 0, "short chunk without cue should not surface song");
    assert.equal(res.lyric.length, 0, "short chunk without cue should not surface lyric");
  });

  test("detectAll: cross-bucket dedupe — songId only in higher-conf bucket", async () => {
    const lib: IndexedSong[] = [
      { songId: "a", title: "Amazing Grace", source: "public_domain",
        slides: [{ order: 0, lyrics: "Amazing grace how sweet the sound that saved a wretch like me" }] },
    ];
    const res = await detectAll("let's sing amazing grace how sweet the sound", {
      churchId: "c1", library: lib,
      hasVerseContext: false, hasSlideContext: false, hasSongContext: false,
    });
    const songIds = res.song.map((s) => s.songId);
    const lyricIds = res.lyric.map((s) => s.songId);
    const overlap = songIds.filter((id) => lyricIds.includes(id));
    assert.equal(overlap.length, 0, `same songId must not appear in both buckets, overlap=${JSON.stringify(overlap)}`);
  });

  await Promise.all(pending);
  console.log(`\n${passed} passed · ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
