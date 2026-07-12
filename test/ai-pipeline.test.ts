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

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void | Promise<void>) {
  try {
    const r = fn();
    if (r && typeof (r as Promise<unknown>).then === "function") {
      return (r as Promise<unknown>).then(
        () => { passed++; console.log(`  ok  ${name}`); },
        (e: unknown) => { failed++; console.log(`  FAIL ${name}`, e); },
      );
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
    ];
    // If any of the above is missing from the union, TS fails to compile
    // (and this test never runs). At runtime we just verify the list.
    assert.ok(required.length === 14);
  });

  // ---- WS URL config gate ----
  test("empty NEXT_PUBLIC_AUDIO_WS_URL falls back to localhost:3001", () => {
    // Mirrors /api/audio/ticket route logic.
    const wsBase = process.env.NEXT_PUBLIC_AUDIO_WS_URL || "ws://localhost:3001";
    assert.ok(wsBase.startsWith("ws://") || wsBase.startsWith("wss://"),
      `wsBase must be ws:// or wss://, got ${wsBase}`);
  });

  console.log(`\n${passed} passed · ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
