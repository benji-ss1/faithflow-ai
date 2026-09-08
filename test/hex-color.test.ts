/**
 * hex-color validator — single source of truth for #rrggbb (Wave 3).
 * Guards both playlist-header recolor and library colour labels.
 * Run: npx tsx test/hex-color.test.ts
 */
import assert from "node:assert/strict";
import { isHex6Color } from "../src/lib/hex-color";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}

check("accepts lower/upper #rrggbb", () => {
  assert.equal(isHex6Color("#16a34a"), true);
  assert.equal(isHex6Color("#FFFFFF"), true);
});
check("rejects shorthand / alpha / missing hash", () => {
  assert.equal(isHex6Color("#fff"), false);
  assert.equal(isHex6Color("#16a34a80"), false);
  assert.equal(isHex6Color("16a34a"), false);
});
check("rejects non-hex + non-strings", () => {
  assert.equal(isHex6Color("#gggggg"), false);
  assert.equal(isHex6Color(""), false);
  assert.equal(isHex6Color(null), false);
  assert.equal(isHex6Color(123), false);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
