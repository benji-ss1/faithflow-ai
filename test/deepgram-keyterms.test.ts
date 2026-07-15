/**
 * Per-church Deepgram keyterm loader tests.
 * Run: npx tsx test/deepgram-keyterms.test.ts
 *
 * Coverage:
 *   1. Missing per-church file → falls back to default.json.
 *   2. Missing default.json + missing per-church → falls back to hard-coded const.
 *   3. Per-church file wins over default when present.
 *   4. Cache hit within TTL avoids disk re-read.
 *   5. Non-string entries in JSON are filtered.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadKeyterms, _clearKeytermCache, DEEPGRAM_KEYTERMS } from "../src/lib/deepgram-keyterms";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  _clearKeytermCache();
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n    ${(e as Error).message}`); }
}

function makeTempConfigDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-keyterms-"));
  fs.mkdirSync(path.join(dir, "deepgram-keyterms"), { recursive: true });
  return dir;
}

// 1. Per-church missing → default.json
test("falls back to default.json when per-church missing", () => {
  const dir = makeTempConfigDir();
  process.env.PF_CONFIG_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "deepgram-keyterms", "default.json"),
    JSON.stringify({ terms: ["Alpha", "Beta"] }),
  );
  const terms = loadKeyterms("church-abc");
  assert.deepEqual(terms, ["Alpha", "Beta"]);
});

// 2. Both missing → hard-coded fallback
test("falls back to DEEPGRAM_KEYTERMS when both files absent", () => {
  const dir = makeTempConfigDir();
  process.env.PF_CONFIG_DIR = dir;
  // no files written
  const terms = loadKeyterms("church-none");
  assert.deepEqual(terms, DEEPGRAM_KEYTERMS);
});

// 3. Per-church override wins
test("per-church file overrides default.json", () => {
  const dir = makeTempConfigDir();
  process.env.PF_CONFIG_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "deepgram-keyterms", "default.json"),
    JSON.stringify({ terms: ["Default1"] }),
  );
  fs.writeFileSync(
    path.join(dir, "deepgram-keyterms", "church-xyz.json"),
    JSON.stringify({ terms: ["Custom1", "Custom2"] }),
  );
  const terms = loadKeyterms("church-xyz");
  assert.deepEqual(terms, ["Custom1", "Custom2"]);
});

// 4. Cache hit — deleting file after load still returns cached
test("cached within TTL — file removal doesn't invalidate", () => {
  const dir = makeTempConfigDir();
  process.env.PF_CONFIG_DIR = dir;
  const file = path.join(dir, "deepgram-keyterms", "default.json");
  fs.writeFileSync(file, JSON.stringify({ terms: ["Cached"] }));
  const first = loadKeyterms(null);
  assert.deepEqual(first, ["Cached"]);
  fs.unlinkSync(file);
  const second = loadKeyterms(null);
  assert.deepEqual(second, ["Cached"], "should hit cache");
});

// 5. Filter non-strings + blanks
test("filters non-string and empty entries", () => {
  const dir = makeTempConfigDir();
  process.env.PF_CONFIG_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "deepgram-keyterms", "default.json"),
    JSON.stringify({ terms: ["Good", 42, "", "  ", null, "Also"] }),
  );
  const terms = loadKeyterms(null);
  assert.deepEqual(terms, ["Good", "Also"]);
});

console.log(`\n${passed} passed · ${failed} failed`);
if (failed > 0) process.exit(1);
