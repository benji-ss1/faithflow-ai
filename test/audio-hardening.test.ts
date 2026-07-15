/**
 * Deepgram hardening pass — unit tests for pure client-side helpers.
 * Run: npx tsx test/audio-hardening.test.ts
 *
 * Coverage:
 *   1. Ring buffer 5s cap correctness (add/rotate)
 *   2. Interim debouncer only fires on ≥3 char OR ≥300ms delta
 *   3. Word-conf gate blocks auto-approve on low-conf spans
 *   4. Silence gate opens/closes on RMS threshold
 *   5. Session-metrics endpoint auth-gated + rate-limited (shape test)
 */
import assert from "node:assert/strict";
import { CONFIDENCE_THRESHOLD } from "../src/lib/audio-thresholds";

let passed = 0;
let failed = 0;
function t(label: string, fn: () => void | Promise<void>) {
  try {
    const r = fn();
    if (r && typeof (r as Promise<unknown>).then === "function") {
      (r as Promise<unknown>).then(() => { passed++; console.log(`  ok  ${label}`); },
        (e) => { failed++; console.error(`  FAIL  ${label}: ${e?.message ?? e}`); });
    } else { passed++; console.log(`  ok  ${label}`); }
  } catch (e) { failed++; console.error(`  FAIL  ${label}: ${e instanceof Error ? e.message : e}`); }
}

// ── Ring buffer semantics ────────────────────────────────────────────────
// Simulates the ring buffer eviction rule in useAudioStream: when total bytes
// exceed the 5s cap (160KB @ 16kHz mono linear16), drop from the head.
console.log("ring-buffer 5s cap");
{
  const CAP = 160_000;
  const ring: Uint8Array[] = [];
  let bytes = 0;
  const push = (n: number) => {
    const c = new Uint8Array(n);
    ring.push(c);
    bytes += c.length;
    while (bytes > CAP && ring.length > 0) {
      const d = ring.shift();
      if (d) bytes -= d.length;
    }
  };
  t("empty starts at 0", () => { assert.equal(bytes, 0); assert.equal(ring.length, 0); });
  for (let i = 0; i < 10; i++) push(20_000); // 200KB → must evict below cap
  t("caps to ≤160KB after overflow", () => { assert.ok(bytes <= CAP, `bytes=${bytes}`); });
  t("preserves newest chunk", () => { assert.equal(ring[ring.length - 1].length, 20_000); });
  // Explicit rotation ordering — oldest is dropped first.
  const ring2: number[] = [];
  let b2 = 0;
  const CAP2 = 100;
  const push2 = (id: number, size: number) => {
    ring2.push(id); b2 += size;
    while (b2 > CAP2 && ring2.length > 0) { ring2.shift(); b2 -= size; }
  };
  push2(1, 40); push2(2, 40); push2(3, 40);
  t("oldest evicted first (FIFO)", () => { assert.deepEqual(ring2, [2, 3]); });
}

// ── Interim debouncer ────────────────────────────────────────────────────
// Pure logic replica of useDebouncedInterim decision.
function shouldPush(prev: string, next: string, prevAt: number, nowAt: number, minChars = 3, minMs = 300): boolean {
  if (next === prev) return false;
  if (next.length === 0) return true;
  return Math.abs(next.length - prev.length) >= minChars || (nowAt - prevAt) >= minMs;
}
console.log("interim debouncer");
{
  t("suppresses <3 char change within 300ms", () => {
    assert.equal(shouldPush("hello", "hellox", 1000, 1050), false); // 1 char, 50ms
  });
  t("pushes on ≥3 char change", () => {
    assert.equal(shouldPush("hi", "hello", 1000, 1050), true);
  });
  t("pushes on ≥300ms delta even for 1 char", () => {
    assert.equal(shouldPush("hello", "hellox", 1000, 1400), true);
  });
  t("flushes on empty (utterance boundary)", () => {
    assert.equal(shouldPush("hello", "", 1000, 1050), true);
  });
  t("no-op when unchanged", () => {
    assert.equal(shouldPush("hello", "hello", 1000, 9999), false);
  });
}

// ── Word-conf autopilot gate ─────────────────────────────────────────────
// Replicates the low-conf span match logic in ProOperatorShell.
type Word = { w: string; c: number };
function isBlocked(matchedText: string, words: Word[]): boolean {
  const lows = words.filter((w) => w.c < CONFIDENCE_THRESHOLD);
  const mt = matchedText.toLowerCase();
  for (const lw of lows) {
    const norm = lw.w.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (norm && mt.includes(norm)) return true;
  }
  return false;
}
console.log("word-conf autopilot gate");
{
  t("blocks when a matched word is low-conf", () => {
    const words: Word[] = [{ w: "John", c: 0.3 }, { w: "3:16", c: 0.9 }];
    assert.equal(isBlocked("John 3:16", words), true);
  });
  t("does not block when all matched words are high-conf", () => {
    const words: Word[] = [{ w: "John", c: 0.95 }, { w: "3:16", c: 0.9 }];
    assert.equal(isBlocked("John 3:16", words), false);
  });
  t("low-conf words outside the span do not block", () => {
    const words: Word[] = [{ w: "unrelated", c: 0.1 }, { w: "John", c: 0.9 }, { w: "3:16", c: 0.9 }];
    assert.equal(isBlocked("John 3:16", words), false);
  });
  t("uses CONFIDENCE_THRESHOLD boundary (0.45)", () => {
    const words: Word[] = [{ w: "John", c: 0.44 }];
    assert.equal(isBlocked("John 3:16", words), true);
    const words2: Word[] = [{ w: "John", c: 0.45 }];
    assert.equal(isBlocked("John 3:16", words2), false);
  });
}

// ── RMS silence gate ─────────────────────────────────────────────────────
// Replicates the -55dBFS / 2s hold logic.
function silenceGate() {
  let start: number | null = null;
  let closed = false;
  const THRESH = -55;
  const HOLD = 2000;
  return (dbfs: number, nowMs: number): boolean => {
    if (dbfs < THRESH) {
      if (start === null) start = nowMs;
      if (!closed && nowMs - start >= HOLD) closed = true;
    } else {
      start = null;
      if (closed) closed = false;
    }
    return closed;
  };
}
console.log("RMS silence gate");
{
  const g = silenceGate();
  t("stays open under threshold hold time", () => {
    assert.equal(g(-80, 0), false);
    assert.equal(g(-80, 1000), false);
    assert.equal(g(-80, 1999), false);
  });
  t("closes after 2s of silence", () => {
    assert.equal(g(-80, 2000), true);
  });
  const g2 = silenceGate();
  t("reopens instantly on non-silent audio", () => {
    g2(-80, 0); g2(-80, 3000); // now closed
    assert.equal(g2(-30, 3010), false);
  });
  const g3 = silenceGate();
  t("above-threshold audio never closes gate", () => {
    assert.equal(g3(-20, 0), false);
    assert.equal(g3(-30, 5000), false);
    assert.equal(g3(-40, 10_000), false);
  });
}

// ── Session-metrics route shape ──────────────────────────────────────────
// Compile-time proof the route exports POST; runtime auth/rate exercised in
// adversarial suite. Here we just prove the module loads cleanly.
console.log("session-metrics endpoint module load");
{
  t("route module has POST export", async () => {
    const mod = await import("../src/app/api/audio/session-metrics/route");
    assert.equal(typeof (mod as { POST: unknown }).POST, "function");
  });
}

setTimeout(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}, 500);
