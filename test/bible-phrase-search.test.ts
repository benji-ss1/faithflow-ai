/**
 * Bible phrase-search branching + min-length gate.
 * Run: npx tsx test/bible-phrase-search.test.ts
 *
 * Unit-level surrogate for BibleMode's `lookup()` dispatcher — mirrors the
 * same isProbablyReference() decision and the same client-side min-3-char
 * gate that the component enforces.
 */
import assert from "node:assert";
import { isProbablyReference } from "../src/lib/bible-parser";

let pass = 0;
let fail = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n         ${(e as Error).message}`); fail++; }
}

type Body = { query?: string; translation?: string; book?: string };
type FetchCall = { url: string; body: Body };

function makeLookup() {
  const calls: FetchCall[] = [];
  const doFetch = async (url: string, init?: { body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    calls.push({ url, body });
  };
  const lookup = async (ref: string) => {
    const treatAsRef = isProbablyReference(ref);
    if (treatAsRef) {
      await doFetch("/api/bible/lookup", { body: JSON.stringify({ book: "John", chapter: 3, verseStart: 16, verseEnd: 16, translationCode: "KJV" }) });
    } else {
      const trimmed = ref.trim();
      if (trimmed.length < 3) return;
      await doFetch("/api/bible/search", { body: JSON.stringify({ query: trimmed, translation: "KJV", limit: 10 }) });
    }
  };
  return { lookup, getCalls: () => calls };
}

async function main() {
  console.log("Bible phrase-search branching + min-length gate");

  await check("phrase (>3 chars, not ref) → /api/bible/search with 'query' key", async () => {
    const { lookup, getCalls } = makeLookup();
    await lookup("The plans of the Lord are good");
    const c = getCalls();
    assert.strictEqual(c.length, 1);
    assert.ok(c[0].url.endsWith("/api/bible/search"));
    assert.strictEqual(c[0].body.query, "The plans of the Lord are good");
    assert.strictEqual(c[0].body.translation, "KJV");
  });

  await check("'hi' (<3 chars) → no request fired", async () => {
    const { lookup, getCalls } = makeLookup();
    await lookup("hi");
    assert.strictEqual(getCalls().length, 0);
  });

  await check("'John 3:16' → reference branch fires /api/bible/lookup", async () => {
    const { lookup, getCalls } = makeLookup();
    await lookup("John 3:16");
    const c = getCalls();
    assert.strictEqual(c.length, 1);
    assert.ok(c[0].url.endsWith("/api/bible/lookup"));
    assert.strictEqual(c[0].body.book, "John");
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
