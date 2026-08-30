/**
 * never-override — manual-takeover suppression tests (2026-08-31).
 *
 * Run: npx tsx test/operator-takeover.test.ts
 * Uses plain node:assert (matching test/bible-antireplay.test.ts).
 *
 * Guards the pure decision core `shouldHoldForOperator` — the exact logic wired
 * into the three auto-fire chokepoints (Bible instant-fire, Bible auto-approve,
 * song auto-live). Proves: hold while driving, re-arm on idle (never a latch),
 * voice bypass, no-op before first interaction, kill-switch, boundary, swap-back.
 */
import assert from "node:assert";
import { shouldHoldForOperator } from "../src/lib/operator-takeover";

const WINDOW = 3500;
let pass = 0;
let fail = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn())
    .then(() => { console.log(`  PASS  ${name}`); pass++; })
    .catch((e) => { console.error(`  FAIL  ${name}\n         ${(e as Error).message}`); fail++; });
}

async function main() {
  console.log("never-override — shouldHoldForOperator");

  await check("HOLDS when the operator just interacted (500ms ago — typing James 4:9)", () => {
    assert.strictEqual(shouldHoldForOperator({ lastInteractionMs: 10_000, now: 10_500, windowMs: WINDOW }), true);
  });

  await check("FIRES once the operator has been idle past the window (re-arms, never latches)", () => {
    assert.strictEqual(shouldHoldForOperator({ lastInteractionMs: 10_000, now: 14_000, windowMs: WINDOW }), false);
  });

  await check("FIRES on an explicit spoken directive even while driving (voiceCommand bypass)", () => {
    assert.strictEqual(shouldHoldForOperator({ lastInteractionMs: 10_000, now: 10_500, windowMs: WINDOW, voiceCommand: true }), false);
  });

  await check("does NOT hold before the operator has ever interacted (lastInteraction = 0)", () => {
    assert.strictEqual(shouldHoldForOperator({ lastInteractionMs: 0, now: 1_000_000, windowMs: WINDOW }), false);
  });

  await check("kill-switch OFF disables the hold entirely (enabled=false)", () => {
    assert.strictEqual(shouldHoldForOperator({ lastInteractionMs: 10_000, now: 10_100, windowMs: WINDOW, enabled: false }), false);
  });

  await check("exactly at the window boundary fires (strict <)", () => {
    assert.strictEqual(shouldHoldForOperator({ lastInteractionMs: 10_000, now: 13_500, windowMs: WINDOW }), false);
  });

  await check("swap-back is not starved: manual A then B detected after the window fires B", () => {
    const stampAt = 100_000;
    assert.strictEqual(shouldHoldForOperator({ lastInteractionMs: stampAt, now: stampAt + 4000, windowMs: WINDOW }), false);
  });

  await check("AI self-fire cannot suppress (no new stamp → governed by old interaction, idle)", () => {
    assert.strictEqual(shouldHoldForOperator({ lastInteractionMs: 50_000, now: 60_000, windowMs: WINDOW }), false);
  });

  await check("windowMs <= 0 never holds (defensive)", () => {
    assert.strictEqual(shouldHoldForOperator({ lastInteractionMs: 10_000, now: 10_100, windowMs: 0 }), false);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
