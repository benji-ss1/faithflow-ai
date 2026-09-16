/**
 * Mic boost policy. Run: npx tsx --test test/mic-boost-policy.test.ts
 * Invariant: macOS (isWindows:false) matches the original inline logic in
 * useAudioStream.ts exactly; Windows only changes the UNSET mic-source default.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveMicBoost, defaultMicBoost } from "../src/lib/audio/micBoostPolicy";

// The pre-change inline implementation, verbatim, as the parity oracle.
function legacy(raw: string | null, isMicSource: boolean): number {
  const parsedBoost = raw === null ? (isMicSource ? 1.5 : 1) : parseFloat(raw);
  const maxBoost = isMicSource ? 3 : 2;
  return Number.isFinite(parsedBoost) ? Math.min(maxBoost, Math.max(1, parsedBoost)) : 1;
}

const RAWS = [null, "1", "1.5", "2", "2.5", "3", "5", "0.5", "0", "-1", "abc", "", "NaN", "Infinity"];

test("macOS: identical to legacy for every input", () => {
  for (const raw of RAWS) for (const mic of [true, false]) {
    assert.equal(resolveMicBoost({ raw, isMicSource: mic, isWindows: false }), legacy(raw, mic), `raw=${raw} mic=${mic}`);
  }
});

test("Windows: unset mic source defaults to 1x (was 1.5x)", () => {
  assert.equal(resolveMicBoost({ raw: null, isMicSource: true, isWindows: true }), 1);
});

test("Windows: every explicit saved value and every mixer case unchanged vs legacy", () => {
  for (const raw of RAWS) for (const mic of [true, false]) {
    if (raw === null && mic) continue;
    assert.equal(resolveMicBoost({ raw, isMicSource: mic, isWindows: true }), legacy(raw, mic), `raw=${raw} mic=${mic}`);
  }
});

test("defaultMicBoost mirrors the runtime default (settings UI label)", () => {
  assert.equal(defaultMicBoost(true, false), 1.5);
  assert.equal(defaultMicBoost(false, false), 1);
  assert.equal(defaultMicBoost(true, true), 1);
  assert.equal(defaultMicBoost(false, true), 1);
});
