/**
 * Bible reference-vs-phrase heuristic tests.
 * Run: npx tsx test/bible-mode.test.ts
 */
import assert from "node:assert";
import { isProbablyReference } from "../src/lib/bible-parser";

let pass = 0;
let fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n         ${(e as Error).message}`); fail++; }
}

console.log("Bible mode heuristic");

check("John 3:16 → reference", () => { assert.strictEqual(isProbablyReference("John 3:16"), true); });
check("Psalm 23 → reference", () => { assert.strictEqual(isProbablyReference("Psalm 23"), true); });
check("1 Cor 13 → reference", () => { assert.strictEqual(isProbablyReference("1 Cor 13"), true); });
check("the Lord is my shepherd → phrase", () => { assert.strictEqual(isProbablyReference("the Lord is my shepherd"), false); });
check("God so loved → phrase", () => { assert.strictEqual(isProbablyReference("God so loved"), false); });
check("empty → false", () => { assert.strictEqual(isProbablyReference(""), false); });

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
