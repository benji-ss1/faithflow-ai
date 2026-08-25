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
import { hybridSearch, lexicalSearch, ftsIndexReady, publicDomainFallbackTranslationId } from "../src/lib/server/bible";

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
  let licensedId: string | undefined;
  let indexPresent = false;
  try {
    const r = await pool.query("select id from bible_translations where code=$1 limit 1", ["KJV"]);
    kjvId = r.rows[0]?.id;
    if (!kjvId) { console.log("⚠ no KJV translation in DB — skipping (not a failure)."); await pool.end(); return; }
    const lic = await pool.query("select id from bible_translations where license_required = true limit 1");
    licensedId = lic.rows[0]?.id;
    const idx = await pool.query("select 1 from pg_class c join pg_index i on i.indexrelid=c.oid where c.relname='idx_bible_verses_fts' and i.indisvalid limit 1");
    indexPresent = idx.rows.length > 0;
  } catch {
    console.log("⚠ DB unreachable — skipping hybrid integration test (not a failure).");
    await pool.end(); return;
  }
  await pool.end();

  console.log("FTS index / lexical arm:");
  await test("idx_bible_verses_fts exists and is valid (migration applied)", async () => {
    assert.ok(indexPresent, "idx_bible_verses_fts missing/invalid — apply docs/migrations/2026-08-25-add-bible-verses-fts.sql");
    assert.equal(await ftsIndexReady(), true, "ftsIndexReady() should report the valid index");
  });
  await test("lexicalSearch resolves an exact quote (Genesis 1:1)", async () => {
    const lex = await lexicalSearch(kjvId, "in the beginning god created the heaven and the earth", 3);
    assert.ok(lex.length > 0 && lex[0].book === "Genesis" && lex[0].chapter === 1 && lex[0].verse === 1,
      `top lexical hit: ${lex[0] ? `${lex[0].book} ${lex[0].chapter}:${lex[0].verse}` : "none"}`);
  });

  const cases: Array<{ label: string; query: string; book: string; chapter: number; verse: number }> = [
    { label: "exact: shepherd", query: "the lord is my shepherd i shall not want", book: "Psalms", chapter: 23, verse: 1 },
    { label: "paraphrase: john 3:16", query: "god loved the world so much he sent his only son", book: "John", chapter: 3, verse: 16 },
    { label: "partial: courage (KJV-primary no-regression)", query: "be strong and of a good courage", book: "Deuteronomy", chapter: 31, verse: 6 },
    { label: "allusion: faith", query: "faith is being sure of what we hope for", book: "Hebrews", chapter: 11, verse: 1 },
    { label: "exact: genesis 1:1", query: "in the beginning god created the heaven and the earth", book: "Genesis", chapter: 1, verse: 1 },
    // ③b: MODERN wording (matches via the WEB corpus, NOT KJV "charity suffereth
    // long"). This is the NIV/NKJV/NLT-church win — the reference resolves and is
    // projected in the church's own translation.
    { label: "modern: love is patient (WEB corpus)", query: "love is patient love is kind it does not envy", book: "1 Corinthians", chapter: 13, verse: 4 },
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

  console.log("Licensed-translation fallback (resolves references via public-domain):");
  await test("hybridSearch on a licensed translation resolves via the PD fallback", async () => {
    if (!licensedId) { console.log("    (no licensed translation in dev DB — skipping this case)"); return; }
    const pd = await publicDomainFallbackTranslationId();
    assert.ok(pd, "a public-domain fallback translation must exist");
    const hits = await hybridSearch(licensedId, "the lord is my shepherd i shall not want", 3);
    assert.ok(hits.length > 0, "licensed search should return PD-resolved references, not []");
    assert.ok(hits[0].book === "Psalms" && hits[0].chapter === 23 && hits[0].verse === 1,
      `top hit: ${hits[0] ? `${hits[0].book} ${hits[0].chapter}:${hits[0].verse}` : "none"}`);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
