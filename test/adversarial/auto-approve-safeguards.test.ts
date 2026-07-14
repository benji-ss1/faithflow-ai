/**
 * Adversarial tests for the auto-approve pipeline safeguards.
 *
 * Covers:
 *   - Confidence boost cap (Y2)
 *   - SuggestionDedupe TTL sweep + LRU cap (R6)
 *   - Nonce-gated custom event bus (Y1)
 *
 * Plain-Node style. Run via:
 *   npx tsx test/adversarial/auto-approve-safeguards.test.ts
 */
import assert from "node:assert";
import { SuggestionDedupe } from "../../src/lib/ai-detection/index";
import { dispatchInternal, isInternalEvent, __getInternalNonceForTest } from "../../src/lib/internal-events";

let pass = 0;
let fail = 0;
function run(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name} — ${(e as Error).message}`); fail++; }
}

// ── R6: SuggestionDedupe TTL + LRU ────────────────────────────────────────
run("SuggestionDedupe TTL sweep evicts stale entries", () => {
  const d = new SuggestionDedupe(30_000);
  const t0 = 1_000_000;
  d.shouldEmit("scripture", "John 3:16", 90, t0);
  assert.strictEqual(d.size(), 1);
  // Advance past TTL (5min) + sweep interval so a subsequent call runs sweep.
  const later = t0 + 6 * 60 * 1000 + 2 * 60 * 1000;
  d.shouldEmit("scripture", "Romans 8:28", 90, later);
  // Old entry should be swept out by the sweep on this call.
  assert.strictEqual(d.size(), 1, `expected sweep to drop John 3:16, size=${d.size()}`);
});

run("SuggestionDedupe LRU cap prevents unbounded growth", () => {
  const d = new SuggestionDedupe(30_000);
  for (let i = 0; i < 600; i++) {
    d.shouldEmit("scripture", `book${i}`, 90, i);
  }
  assert.ok(d.size() <= 500, `expected size<=500, got ${d.size()}`);
});

// ── Y2: confidence boost cap ──────────────────────────────────────────────
run("blend boost capped at parserConf+10 (out-of-range fake range)", () => {
  // Replicate the blend formula from useAudioStream.
  const blend = (parserConf: number, matchedText: string, verseStart: number, verseEnd: number, dg?: number) => {
    const dgConf = typeof dg === "number" && dg > 0 && dg <= 1 ? dg : 1;
    const wellFormed = /\d+\s*:\s*\d+/.test(matchedText);
    const rawBoost = (wellFormed ? 10 : 0) + (verseEnd > verseStart ? 5 : 0);
    const boost = Math.min(rawBoost, 10);
    const base = Math.round(parserConf * dgConf);
    return Math.max(1, Math.min(100, Math.min(base + boost, parserConf + 10)));
  };
  // Well-formed multi-verse range with parserConf 70 → capped at 80, not 85.
  const final = blend(70, "John 3:16-99", 16, 99);
  assert.ok(final <= 80, `expected <=80, got ${final}`);
});

run("blend cap doesn't hurt well-formed single-verse refs (still lifts)", () => {
  const blend = (parserConf: number, matchedText: string, verseStart: number, verseEnd: number) => {
    const wellFormed = /\d+\s*:\s*\d+/.test(matchedText);
    const rawBoost = (wellFormed ? 10 : 0) + (verseEnd > verseStart ? 5 : 0);
    const boost = Math.min(rawBoost, 10);
    const base = Math.round(parserConf);
    return Math.max(1, Math.min(100, Math.min(base + boost, parserConf + 10)));
  };
  const final = blend(85, "John 3:16", 16, 16);
  assert.strictEqual(final, 95);
});

// ── Y1: nonce-gated event bus ─────────────────────────────────────────────
run("isInternalEvent accepts dispatchInternal-produced events", () => {
  // No window in Node — simulate via minimal CustomEvent-like object.
  const nonce = __getInternalNonceForTest();
  const good = { detail: { nonce } } as unknown as Event;
  assert.strictEqual(isInternalEvent(good), true);
});

run("isInternalEvent rejects foreign detail (no nonce)", () => {
  const bad = { detail: { action: "kill_live" } } as unknown as Event;
  assert.strictEqual(isInternalEvent(bad), false);
});

run("isInternalEvent rejects Symbol-for spoofing", () => {
  // Attempt to create a lookalike nonce via Symbol.for — must NOT match.
  const spoof = { detail: { nonce: Symbol.for("presentflow.internal-nonce.v1") } } as unknown as Event;
  assert.strictEqual(isInternalEvent(spoof), false);
});

run("dispatchInternal is a no-op with no window (Node)", () => {
  // Should not throw.
  dispatchInternal("presentflow:bible-next");
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
