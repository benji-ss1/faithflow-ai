/**
 * Bible silence+coverage auto-advance — REPEAT-HOLD gate (2026-08-30).
 *
 * Part 2c (ProOperatorShell) advances to the next verse on "current verse
 * covered + ~2.5s silence". African-Pentecostal preachers re-read/repeat the
 * live verse and pause constantly, which used to jump the screen to the next
 * verse "just because it was already up". The gate now also requires positive
 * evidence the NEXT verse is being read: matchNextSlide(recentWords, nextTEXT)
 * .consecutiveMatches >= BIBLE_NEXT_EVIDENCE_MIN (3).
 *
 * CRITICAL: the evidence must be matched against the verse TEXT ONLY — NOT the
 * "17 <text>" number-prefixed body. matchNextSlide anchors every run at the
 * target's first token; the spoken stream never contains the verse NUMBER, so
 * the numbered body scored 0 for continuous reading and would have stranded
 * genuine advance. This test locks both directions.
 *
 * Run: npx tsx test/bible-silence-advance.test.ts
 */
import assert from "node:assert/strict";
import { matchNextSlide } from "../src/lib/ai-detection/lyric-position";
import { BIBLE_NEXT_EVIDENCE_MIN } from "../src/components/operator/pro/operatorConstants";

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : e}`); }
}
const toks = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
const advances = (recent: string, nextText: string) =>
  matchNextSlide(toks(recent), nextText).consecutiveMatches >= BIBLE_NEXT_EVIDENCE_MIN;

const v16 = "For God so loved the world that he gave his one and only Son";
const v17text = "For God did not send his Son into the world to condemn the world";
const v17numbered = "17 " + v17text;

console.log("Genuine forward reading ADVANCES (evidence >= min):");
test('preacher has started the next verse → advances', () =>
  assert.equal(advances("that he gave his son. for god did not send his son", v17text), true));

console.log("\nRepeats / reference restatements HOLD (evidence < min):");
test('re-reading the current verse → holds', () =>
  assert.equal(advances(v16 + " " + v16, v17text), false));
test('reference-only repeat ("John 3:16 …") → holds', () =>
  assert.equal(advances("john three sixteen john three sixteen john three sixteen", v17text), false));

console.log("\nRegression lock: the number-prefixed body must NOT be used:");
test('numbered next-body scores 0 for spoken forward reading (why we strip it)', () =>
  assert.equal(matchNextSlide(toks("for god did not send his son"), v17numbered).consecutiveMatches, 0));
test('text-only next-body scores >= min for the same spoken forward reading', () =>
  assert.ok(matchNextSlide(toks("for god did not send his son"), v17text).consecutiveMatches >= BIBLE_NEXT_EVIDENCE_MIN));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
