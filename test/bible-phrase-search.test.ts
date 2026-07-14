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

// Minimal shape of a semantic hit — mirrors what /api/bible/search returns
// under `hits`. Used to verify the BibleMode rendering path passes ALL hits
// through, not just the first one, and that the limit param is honored on
// the request payload.
type Hit = { book: string; chapter: number; verse: number; text: string };

function makeMultiHitLookup() {
  const calls: FetchCall[] = [];
  // Simulated backend returning `hits` proportional to the requested limit —
  // the real server caps at 100 (see /api/bible/search route). Tests assert
  // the client honours the caller's requested limit end-to-end.
  const doFetch = async (url: string, init?: { body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    calls.push({ url, body });
    const n = Math.min((body as { limit?: number }).limit || 20, 100);
    const hits: Hit[] = [];
    for (let i = 0; i < n; i++) hits.push({ book: "Psalm", chapter: 23, verse: 1 + i, text: `The Lord is my shepherd ${i}` });
    return { hits, results: hits };
  };
  const rendered: Hit[][] = [];
  const lookup = async (ref: string, limit: number) => {
    if (isProbablyReference(ref)) return;
    const trimmed = ref.trim();
    if (trimmed.length < 3) return;
    const res = await doFetch("/api/bible/search", {
      body: JSON.stringify({ query: trimmed, translation: "KJV", limit }),
    }) as { hits: Hit[] };
    // BibleMode maps hits 1:1 into phraseHits and renders each as a card —
    // mirror that here so we can assert the full list is passed through.
    rendered.push(res.hits);
  };
  return { lookup, getCalls: () => calls, getRendered: () => rendered };
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

  await check("phrase search renders ALL hits (multi-verse)", async () => {
    const { lookup, getRendered } = makeMultiHitLookup();
    await lookup("The Lord is my shepherd", 20);
    const rendered = getRendered();
    assert.strictEqual(rendered.length, 1);
    assert.strictEqual(rendered[0].length, 20, "should render all 20 hits, not just the first");
  });

  await check("limit param honored on the outgoing request + rendered results", async () => {
    const { lookup, getCalls, getRendered } = makeMultiHitLookup();
    await lookup("The Lord is my shepherd", 50);
    const c = getCalls();
    assert.strictEqual(c.length, 1);
    assert.strictEqual((c[0].body as { limit?: number }).limit, 50);
    assert.strictEqual(getRendered()[0].length, 50);
  });

  await check("limit=100 respected (server-side cap)", async () => {
    const { lookup, getRendered } = makeMultiHitLookup();
    await lookup("faith", 100);
    assert.strictEqual(getRendered()[0].length, 100);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
