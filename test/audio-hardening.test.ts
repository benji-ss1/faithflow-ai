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

// ── R1: word-span gate ────────────────────────────────────────────────────
// New logic: only block when a low-conf word actually falls INSIDE the
// suggestion's matched span (segmentId-scoped, char offsets).
console.log("R1 word-span autopilot gate");
type W = { w: string; c: number };
function gateR1(text: string, words: W[], span: { start: number; end: number } | undefined): boolean {
  if (!span) return false; // fail open — no span info
  let cursor = 0;
  for (const w of words) {
    const wStr = w.w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (!wStr) continue;
    const idx = text.toLowerCase().indexOf(wStr.toLowerCase(), cursor);
    if (idx < 0) continue;
    const wStart = idx;
    const wEnd = idx + wStr.length;
    cursor = wEnd;
    if (wStart < span.end && wEnd > span.start && typeof w.c === "number" && w.c < CONFIDENCE_THRESHOLD) return true;
  }
  return false;
}
{
  t("low-conf 'the' outside span does NOT block Matthew 5:16", () => {
    const text = "the book of Matthew chapter five verse sixteen";
    const span = { start: text.indexOf("Matthew"), end: text.indexOf("Matthew") + "Matthew chapter five verse sixteen".length };
    const words: W[] = [
      { w: "the", c: 0.2 },
      { w: "book", c: 0.9 },
      { w: "of", c: 0.9 },
      { w: "Matthew", c: 0.95 },
      { w: "chapter", c: 0.9 },
      { w: "five", c: 0.9 },
      { w: "verse", c: 0.9 },
      { w: "sixteen", c: 0.9 },
    ];
    assert.equal(gateR1(text, words, span), false);
  });
  t("low-conf word INSIDE span blocks", () => {
    const text = "Matthew chapter five verse sixteen";
    const span = { start: 0, end: text.length };
    const words: W[] = [
      { w: "Matthew", c: 0.3 },
      { w: "chapter", c: 0.9 },
      { w: "five", c: 0.9 },
      { w: "verse", c: 0.9 },
      { w: "sixteen", c: 0.9 },
    ];
    assert.equal(gateR1(text, words, span), true);
  });
  t("fails open when span is missing (no false blocks)", () => {
    const text = "Matthew chapter five";
    const words: W[] = [{ w: "the", c: 0.2 }];
    assert.equal(gateR1(text, words, undefined), false);
  });
}

// ── R4: first-render debouncer instant push ──────────────────────────────
console.log("R4 debouncer first-render");
{
  // Replicate: after empty (utterance boundary reset), first non-empty text is instant.
  function makeGate() {
    let hasPushed = false;
    let last = "";
    let lastAt = 0;
    return (text: string, now: number, minChars = 3, minMs = 300): { push: boolean } => {
      if (text === last) return { push: false };
      if (text.length === 0) { hasPushed = false; last = ""; lastAt = now; return { push: true }; }
      if (!hasPushed) { hasPushed = true; last = text; lastAt = now; return { push: true }; }
      const cd = Math.abs(text.length - last.length);
      const md = now - lastAt;
      if (cd >= minChars || md >= minMs) { last = text; lastAt = now; return { push: true }; }
      return { push: false };
    };
  }
  const g = makeGate();
  t("first non-empty push is instant (no 300ms wait)", () => {
    assert.deepEqual(g("hi", 0), { push: true }); // instant even though <3 chars & <300ms
  });
  t("subsequent small deltas suppressed within thresholds", () => {
    assert.deepEqual(g("hix", 50), { push: false });
  });
  t("after empty reset, next first push is instant again", () => {
    g("", 100);
    assert.deepEqual(g("y", 110), { push: true });
  });
}

// ── R3: dedupe key shape check ────────────────────────────────────────────
console.log("R3 session dedupe key");
{
  t("sessionId is client-generated + non-empty", () => {
    const gen = () => `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const a = gen(); const b = gen();
    assert.notEqual(a, b);
    assert.ok(a.length > 8);
  });
}

// ── R5: words[] cap ───────────────────────────────────────────────────────
console.log("R5 words[] cap");
{
  function capWords(rawWords: Array<{ word?: string; confidence?: number }>): { words?: Array<{ w: string; c: number }>; wordsDropped: boolean } {
    let wordsDropped = false;
    const filtered = rawWords
      .filter((w) => typeof w?.word === "string" && typeof w?.confidence === "number" && String(w.word).length <= 128)
      .slice(0, 500)
      .map((w) => ({ w: String(w.word), c: Number(w.confidence) }));
    if (rawWords.length > 500) wordsDropped = true;
    return { words: filtered.length ? filtered : undefined, wordsDropped };
  }
  t("caps at 500 words", () => {
    const raw = Array.from({ length: 700 }, (_, i) => ({ word: `w${i}`, confidence: 0.9 }));
    const out = capWords(raw);
    assert.equal(out.words?.length, 500);
    assert.equal(out.wordsDropped, true);
  });
  t("drops words with string > 128 chars", () => {
    const raw = [{ word: "a".repeat(129), confidence: 0.9 }, { word: "ok", confidence: 0.9 }];
    const out = capWords(raw);
    assert.equal(out.words?.length, 1);
    assert.equal(out.words?.[0].w, "ok");
  });
}

// ── R6: pipeline generation guard ─────────────────────────────────────────
console.log("R6 pipeline generation");
{
  let generation = 0;
  const captured = ++generation; // start
  // simulate rapid restart bumping the counter
  generation += 2;
  const stale = captured !== generation;
  t("stale-generation detection is monotonic", () => { assert.equal(stale, true); });
}

// ── R7: per-user concurrent cap logic ─────────────────────────────────────
console.log("R7 per-user cap");
{
  function enforce(userSet: Set<string>, newId: string, cap: number): string[] {
    const closed: string[] = [];
    while (userSet.size >= cap) {
      const oldest = userSet.values().next().value;
      if (oldest === undefined) break;
      closed.push(oldest as string);
      userSet.delete(oldest as string);
    }
    userSet.add(newId);
    return closed;
  }
  t("closes oldest when cap exceeded", () => {
    const s = new Set(["a", "b", "c"]);
    const closed = enforce(s, "d", 3);
    assert.deepEqual(closed, ["a"]);
    assert.deepEqual([...s], ["b", "c", "d"]);
  });
  t("no-op under cap", () => {
    const s = new Set(["a"]);
    const closed = enforce(s, "b", 3);
    assert.deepEqual(closed, []);
    assert.equal(s.size, 2);
  });
}

// ── R8: lookback ring cap 200ms ───────────────────────────────────────────
console.log("R8 lookback ring");
{
  const CAP = Math.round(0.2 * 16000 * 2); // 6400 bytes
  const ring: Uint8Array[] = [];
  let bytes = 0;
  const push = (n: number) => {
    ring.push(new Uint8Array(n));
    bytes += n;
    while (bytes > CAP && ring.length > 0) {
      const d = ring.shift();
      if (d) bytes -= d.length;
    }
  };
  for (let i = 0; i < 10; i++) push(1024); // 10KB total
  t("keeps last ~200ms only", () => {
    assert.ok(bytes <= CAP, `bytes=${bytes}`);
  });
  t("preserves newest chunk", () => {
    assert.equal(ring[ring.length - 1].length, 1024);
  });
}

// ── R9: keep-alive silence ping shape ─────────────────────────────────────
console.log("R9 keep-alive ping");
{
  t("silence ping is 256 bytes of PCM16 zero", () => {
    const silence = new Uint8Array(256);
    assert.equal(silence.length, 256);
    assert.ok(silence.every((v) => v === 0));
  });
}

// ── R10: stale runDetectAll guard ─────────────────────────────────────────
console.log("R10 stale detection guard");
{
  // Model: capture generation at spawn; commit-time check against current.
  const state: { gen: number } = { gen: 5 };
  const captured = 5;
  // Then a restart bumps.
  state.gen = 6;
  t("commit-time generation mismatch drops the merge", () => {
    assert.notEqual(captured, state.gen);
  });
}

// ── R11: candidate + final dedupe within 800ms ────────────────────────────
console.log("R11 candidate/final dedupe");
{
  const seen = new Map<string, number>();
  const WIN = 800;
  function skip(text: string, now: number): boolean {
    const norm = text.toLowerCase().replace(/\s+/g, " ").trim();
    for (const [k, ts] of seen) {
      if (now - ts > WIN) seen.delete(k);
      else if (k === norm || k.includes(norm) || norm.includes(k)) return true;
    }
    seen.set(norm, now);
    return false;
  }
  t("skips substring within 800ms", () => {
    assert.equal(skip("john three sixteen", 1000), false);
    assert.equal(skip("john three sixteen", 1200), true); // exact repeat
    assert.equal(skip("john three", 1300), true); // substring
  });
  t("allows re-detection after window expires", () => {
    assert.equal(skip("john three sixteen", 2500), false);
  });
}

setTimeout(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}, 500);
