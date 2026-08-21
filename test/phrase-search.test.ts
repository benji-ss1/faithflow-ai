/**
 * Bible phrase-search engine + detectAll phrase-fallback wiring.
 * Run: npx tsx test/phrase-search.test.ts
 *
 * Covers:
 *  - engine: known phrase → correct reference
 *  - detectAll: confidence NEVER exceeds 74 (2026-07-28 sign-off — phrase
 *    matches must stay below the 90 auto-approve floor; the cap must never
 *    be raised)
 *  - detectAll: isPhraseMatch provenance flag set
 *  - phrase cooldown: repeat within TTL blocked, _resetPhraseCooldown works
 *  - direct reference ALWAYS wins over phrase (scripture.length>0 guard)
 *  - non-quote ordinary sentence → no phrase suggestion
 *  - corpus sanity: 5 known entries resolve to valid canonical books
 */
import assert from "node:assert";
import { phraseSearch, topPhraseForSpeech, findPhraseByReference, _resetIndex } from "../src/services/bible/phraseSearch";
import { BIBLE_PHRASES } from "../src/data/biblePhrases";
import { detectAll, _resetPhraseCooldown, type DetectAllContext } from "../src/lib/ai-detection";
import { knownBook } from "../src/lib/bible-parser";

let pass = 0;
let fail = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n         ${(e as Error).message}`); fail++; }
}

const ctx: DetectAllContext = {
  churchId: "test-church",
  hasVerseContext: false,
  hasSlideContext: false,
  hasSongContext: false,
};

async function main() {
  console.log("Phrase-search engine + detectAll fallback");

  // ---------- engine ----------
  await check("engine: 'for God so loved the world' → John 3:16 top hit", () => {
    _resetIndex();
    const hits = phraseSearch("for God so loved the world");
    assert.ok(hits.length > 0, "expected hits");
    assert.strictEqual(hits[0].entry.reference, "John 3:16");
    assert.strictEqual(hits[0].primary, "phrase");
  });

  await check("engine: 'the Lord is my shepherd' → Psalm 23:1", () => {
    const hits = phraseSearch("the Lord is my shepherd");
    assert.ok(hits.length > 0);
    assert.ok(/^Psalms? 23:1$/.test(hits[0].entry.reference), `got ${hits[0].entry.reference}`);
  });

  await check("engine: empty / non-string input → []", () => {
    assert.deepStrictEqual(phraseSearch(""), []);
    assert.deepStrictEqual(phraseSearch("   "), []);
    // @ts-expect-error deliberate bad input
    assert.deepStrictEqual(phraseSearch(null), []);
  });

  await check("engine: topPhraseForSpeech returns null below the 70 floor", () => {
    const weak = topPhraseForSpeech("zzz qqq xxx");
    assert.strictEqual(weak, null);
  });

  // Worship-vocabulary suppression (field 2026-08-21): sung worship phrases made
  // of generic devotional words must NOT surface as false scripture chips.
  await check("engine: generic worship phrases produce NO phrase match", () => {
    for (const q of [
      "who is seated at the right hand",
      "at the right hand of the",
      "holy you are holy",
      "praise the lord o my soul lord",
    ]) {
      assert.strictEqual(topPhraseForSpeech(q), null, `worship phrase leaked a chip: "${q}"`);
    }
  });
  await check("engine: genuine spoken quotes still match despite worship stopwords", () => {
    // These carry a DISTINCTIVE word (shepherd / world / strengtheneth), so the
    // distinctiveness gate leaves them untouched.
    assert.ok(topPhraseForSpeech("the lord is my shepherd i shall not want"), "Psalm 23 lost");
    assert.ok(topPhraseForSpeech("for god so loved the world that he gave his only begotten son"), "John 3:16 lost");
  });

  // ---------- detectAll cap ----------
  await check("detectAll: phrase match confidence never exceeds 74 + isPhraseMatch set", async () => {
    _resetPhraseCooldown();
    const res = await detectAll("and then he said for God so loved the world that he gave his only begotten son", ctx);
    assert.strictEqual(res.scripture.length, 1, "expected one phrase suggestion");
    const s = res.scripture[0];
    assert.strictEqual(s.isPhraseMatch, true);
    assert.ok(s.confidence <= 74, `confidence ${s.confidence} exceeds the 74 cap`);
    assert.strictEqual(s.needsSemanticFallback, true);
    assert.strictEqual(s.book, "John");
    assert.strictEqual(s.chapter, 3);
    assert.strictEqual(s.verseStart, 16);
  });

  await check("detectAll: cap holds across a sweep of high-scoring corpus phrases", async () => {
    for (const e of BIBLE_PHRASES.slice(0, 25)) {
      _resetPhraseCooldown();
      const res = await detectAll(`he was saying ${e.phrase}`, ctx);
      for (const s of res.scripture) {
        if (s.isPhraseMatch) {
          assert.ok(s.confidence <= 74, `${e.reference}: confidence ${s.confidence} > 74`);
        }
      }
    }
  });

  // ---------- cooldown ----------
  await check("detectAll: cooldown blocks repeat within TTL; reset re-allows", async () => {
    _resetPhraseCooldown();
    const first = await detectAll("for God so loved the world", ctx);
    assert.strictEqual(first.scripture.length, 1, "first pass should emit");
    const second = await detectAll("for God so loved the world", ctx);
    assert.strictEqual(second.scripture.length, 0, "repeat within 15s cooldown must be suppressed");
    _resetPhraseCooldown();
    const third = await detectAll("for God so loved the world", ctx);
    assert.strictEqual(third.scripture.length, 1, "after reset the phrase should emit again");
  });

  // ---------- direct reference wins ----------
  await check("detectAll: direct reference wins — phrase branch skipped", async () => {
    _resetPhraseCooldown();
    const res = await detectAll("turn with me to Romans 8:28 for God so loved the world", ctx);
    assert.ok(res.scripture.length > 0);
    for (const s of res.scripture) {
      assert.ok(!s.isPhraseMatch, "no phrase-flagged suggestion when a direct ref parsed");
    }
    assert.strictEqual(res.scripture[0].book, "Romans");
  });

  // ---------- non-quote speech ----------
  await check("detectAll: ordinary announcement sentence → no scripture", async () => {
    _resetPhraseCooldown();
    const res = await detectAll("please remember the car park closes at nine and the youth meeting moves to tuesday", ctx);
    assert.strictEqual(res.scripture.length, 0);
  });

  // ---------- corpus sanity ----------
  await check("corpus: 5 known entries resolve via findPhraseByReference + knownBook", () => {
    const known: Array<[string, string]> = [
      ["for God so loved the world", "John 3:16"],
      ["I can do all things through Christ", "Philippians 4:13"],
      ["the Lord is my shepherd", "Psalms 23:1"],
      ["trust in the Lord with all thine heart", "Proverbs 3:5"],
      ["in the beginning God created", "Genesis 1:1"],
    ];
    for (const [phrase, ref] of known) {
      const hits = phraseSearch(phrase);
      assert.ok(hits.length > 0, `no hits for "${phrase}"`);
      const norm = (r: string) => r.replace(/^Psalm /, "Psalms ");
      assert.strictEqual(norm(hits[0].entry.reference), norm(ref), `"${phrase}" → ${hits[0].entry.reference}, wanted ${ref}`);
      const entry = findPhraseByReference(hits[0].entry.reference);
      assert.ok(entry, `findPhraseByReference miss for ${hits[0].entry.reference}`);
      assert.ok(knownBook(entry!.book), `book "${entry!.book}" not canonical per knownBook()`);
    }
  });

  await check("corpus: every entry's book resolves via knownBook()", () => {
    const bad = BIBLE_PHRASES.filter((e) => !knownBook(e.book));
    assert.strictEqual(bad.length, 0, `unresolvable books: ${[...new Set(bad.map((e) => e.book))].join(", ")}`);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
