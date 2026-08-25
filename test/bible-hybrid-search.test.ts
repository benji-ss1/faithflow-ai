/**
 * Increment ③ of the Bible-detection rebuild (2026-08-25): hybrid quote→verse
 * search. Integration test — needs a LOCAL dev DB (DATABASE_URL) with an
 * embedded KJV and the FTS index (idx_bible_verses_fts). Skips gracefully if
 * the DB is unreachable so it never blocks a no-DB run.
 *
 * Proves the hybrid (lexical FTS ⊕ semantic vector, RRF-fused) resolves:
 *   - exact quotations   → the right verse ranks #1 (lexical arm)
 *   - paraphrases        → the right verse ranks #1 (semantic arm)
 *   - partial quotes     → the right verse ranks #1 (both)
 *
 * Run: npx tsx --env-file=.env.local test/bible-hybrid-search.test.ts
 */
import assert from "node:assert/strict";
import { Pool } from "pg";
import { hybridSearch } from "../src/lib/server/bible";

let passed = 0, failed = 0;
function test(name: string, fn: () => Promise<void>) {
  return fn().then(
    () => { passed++; console.log(`  ✓ ${name}`); },
    (e) => { failed++; console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : e}`); },
  );
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let kjvId: string;
  try {
    const r = await pool.query("select id from bible_translations where code=$1 limit 1", ["KJV"]);
    kjvId = r.rows[0]?.id;
    if (!kjvId) { console.log("⚠ no KJV translation in DB — skipping (not a failure)."); await pool.end(); return; }
  } catch {
    console.log("⚠ DB unreachable — skipping hybrid integration test (not a failure).");
    await pool.end(); return;
  }
  await pool.end();

  const cases: Array<{ label: string; query: string; book: string; chapter: number; verse: number }> = [
    { label: "exact: shepherd", query: "the lord is my shepherd i shall not want", book: "Psalms", chapter: 23, verse: 1 },
    { label: "paraphrase: john 3:16", query: "god loved the world so much he sent his only son", book: "John", chapter: 3, verse: 16 },
    { label: "partial: courage", query: "be strong and of a good courage", book: "Deuteronomy", chapter: 31, verse: 6 },
    { label: "allusion: faith", query: "faith is being sure of what we hope for", book: "Hebrews", chapter: 11, verse: 1 },
    { label: "exact: genesis 1:1", query: "in the beginning god created the heaven and the earth", book: "Genesis", chapter: 1, verse: 1 },
  ];

  for (const c of cases) {
    await test(`${c.label} → ${c.book} ${c.chapter}:${c.verse} ranks #1`, async () => {
      const hits = await hybridSearch(kjvId, c.query, 3);
      assert.ok(hits.length > 0, `no hits for "${c.query}"`);
      const top = hits[0];
      assert.equal(top.book, c.book, `book (top3: ${hits.map((h) => `${h.book} ${h.chapter}:${h.verse}`).join(", ")})`);
      assert.equal(top.chapter, c.chapter, "chapter");
      assert.equal(top.verse, c.verse, "verse");
    });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
