/**
 * ⌘K palette Bible search — group presence, the symmetric reference gate, and
 * the rate-limit contract (debounce + min-length + abort).
 *
 * Run: npx tsx test/bible-palette-search.test.ts
 *
 * These are the PURE decision helpers the palette renders from
 * (`src/lib/bible-palette-search.ts`) — the component maps them 1:1 onto
 * `bibleVerseHits` / `phraseHits` / `lyricEnabled`. Fetch is mocked; no DB.
 */
import assert from "node:assert/strict";
import {
  createBiblePaletteSearcher,
  dedupeAgainstShown,
  isConfirmedBibleReference,
  shouldRunBiblePaletteSearch,
  refKey,
  type BiblePaletteHit,
} from "../src/lib/bible-palette-search";
import { _clearBibleSearchCache } from "../src/lib/bible-search-cache";

let pass = 0, fail = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n         ${(e as Error).message}`); fail++; }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const HIT_1COR: BiblePaletteHit = { book: "1 Corinthians", chapter: 13, verse: 4, text: "Love is patient and kind." };
const HIT_JOHN: BiblePaletteHit = { book: "John", chapter: 3, verse: 16, text: "For God so loved the world…" };

type Call = { url: string; body: { query?: string; limit?: number }; aborted: () => boolean };
function makeFetch(hits: BiblePaletteHit[] = [HIT_1COR], delayMs = 0) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const signal = init?.signal as AbortSignal | undefined;
    calls.push({
      url,
      body: init?.body ? JSON.parse(String(init.body)) : {},
      aborted: () => !!signal?.aborted,
    });
    if (delayMs) await sleep(delayMs);
    return { ok: true, json: async () => ({ hits }) };
  };
  return { fetchImpl, calls };
}

// The palette's lyric gate + phrase gate both read this one predicate.
const lyricEnabled = (q: string) => q.trim().split(/\s+/).filter(Boolean).length >= 2 && !isConfirmedBibleReference(q);
const phraseGroupShown = (q: string) => q.trim().length >= 2 && !isConfirmedBibleReference(q);

async function main() {
  console.log("Bible group renders for a plain phrase:");
  await check("a plain phrase produces Bible verse hits (mocked fetch)", async () => {
    _clearBibleSearchCache();
    const { fetchImpl, calls } = makeFetch();
    let got: BiblePaletteHit[] = [];
    const s = createBiblePaletteSearcher({ onResults: (_q, h) => { got = h; }, fetchImpl, debounceMs: 10 });
    s.search("love is patient");
    await sleep(60);
    assert.equal(calls.length, 1, "one request");
    assert.equal(calls[0].url, "/api/bible/search");
    assert.equal(calls[0].body.query, "love is patient");
    assert.equal(got.length, 1, "Bible group is non-empty → it renders");
    assert.equal(got[0].book, "1 Corinthians");
  });

  await check("under 3 characters never hits the network", async () => {
    _clearBibleSearchCache();
    const { fetchImpl, calls } = makeFetch();
    const s = createBiblePaletteSearcher({ onResults: () => {}, fetchImpl, debounceMs: 10 });
    s.search("lo");
    await sleep(40);
    assert.equal(calls.length, 0);
    assert.equal(shouldRunBiblePaletteSearch("lo"), false);
  });

  console.log("Reference query — lyrics suppressed, Bible still served:");
  await check("'John 3:16' suppresses lyrics", () => {
    assert.equal(isConfirmedBibleReference("John 3:16"), true);
    assert.equal(lyricEnabled("John 3:16"), false, "lyric group hidden");
  });
  await check("'John 3:16' is served by the local fast path, not the network", async () => {
    _clearBibleSearchCache();
    const { fetchImpl, calls } = makeFetch();
    const s = createBiblePaletteSearcher({ onResults: () => {}, fetchImpl, debounceMs: 10 });
    s.search("John 3:16");
    await sleep(40);
    assert.equal(calls.length, 0, "no wasted request — COMMON_REFS/parser resolves it instantly");
    assert.equal(shouldRunBiblePaletteSearch("John 3:16"), false);
  });

  console.log("Symmetric gate (fix 3) — digit-bearing lyric keeps BOTH groups:");
  await check("'bless the lord 10000 reasons' keeps lyric AND Bible/phrase groups", async () => {
    const q = "bless the lord 10000 reasons";
    assert.equal(isConfirmedBibleReference(q), false, "not a parser-confirmed reference");
    assert.equal(lyricEnabled(q), true, "lyric group kept");
    assert.equal(phraseGroupShown(q), true, "Bible/phrase group kept (was suppressed by the loose regex)");
    assert.equal(shouldRunBiblePaletteSearch(q), true, "verse search still runs");
  });
  await check("a real reference still suppresses the phrase group", () => {
    assert.equal(phraseGroupShown("Romans 8:28"), false);
  });

  console.log("Rate-limit contract (shared 20/min bucket with BibleMode):");
  await check("≤1 request per typed word", async () => {
    _clearBibleSearchCache();
    const { fetchImpl, calls } = makeFetch();
    const s = createBiblePaletteSearcher({ onResults: () => {}, fetchImpl, debounceMs: 40 });
    // Type three words character by character, ~8ms apart (fast typing), with
    // a natural pause after each word.
    const words = ["love ", "is ", "patient"];
    let typed = "";
    for (const w of words) {
      for (const ch of w) { typed += ch; s.search(typed); await sleep(8); }
      await sleep(80); // pause between words → at most one flush each
    }
    await sleep(80);
    assert.ok(calls.length <= words.length, `expected ≤${words.length} requests, got ${calls.length}`);
    console.log(`         (typed ${typed.length} characters / ${words.length} words → ${calls.length} requests)`);
  });

  await check("continuous typing with no pause issues exactly 1 request", async () => {
    _clearBibleSearchCache();
    const { fetchImpl, calls } = makeFetch();
    const s = createBiblePaletteSearcher({ onResults: () => {}, fetchImpl, debounceMs: 40 });
    let typed = "";
    for (const ch of "the lord is my shepherd") { typed += ch; s.search(typed); await sleep(5); }
    await sleep(100);
    assert.equal(calls.length, 1, `expected 1 request, got ${calls.length}`);
  });

  await check("superseded in-flight request is aborted", async () => {
    _clearBibleSearchCache();
    const { fetchImpl, calls } = makeFetch([HIT_1COR], 80); // slow response
    const results: string[] = [];
    const s = createBiblePaletteSearcher({ onResults: (q) => results.push(q), fetchImpl, debounceMs: 5 });
    s.search("love is pat");
    await sleep(30);            // first request in flight
    s.search("the lord is my shepherd");
    await sleep(200);
    assert.equal(calls.length, 2, "two requests issued");
    assert.equal(calls[0].aborted(), true, "the superseded one was aborted");
    assert.ok(!results.includes("love is pat"), "a stale response never lands");
    assert.ok(results.includes("the lord is my shepherd"), "the newest query does");
  });

  await check("repeating a query costs ZERO extra requests (session cache)", async () => {
    _clearBibleSearchCache();
    const { fetchImpl, calls } = makeFetch();
    let got: BiblePaletteHit[] = [];
    const s = createBiblePaletteSearcher({ onResults: (_q, h) => { got = h; }, fetchImpl, debounceMs: 10 });
    s.search("love is patient"); await sleep(50);
    s.search("love is patient"); await sleep(50);
    assert.equal(calls.length, 1, "second identical search served from cache");
    assert.equal(got.length, 1, "and still renders results");
  });

  await check("cancel() (palette closed) kills the pending request", async () => {
    _clearBibleSearchCache();
    const { fetchImpl, calls } = makeFetch();
    const s = createBiblePaletteSearcher({ onResults: () => {}, fetchImpl, debounceMs: 30 });
    s.search("love is patient");
    s.cancel();
    await sleep(80);
    assert.equal(calls.length, 0);
  });

  console.log("Dedupe against the fast path:");
  await check("a reference already shown is not repeated", () => {
    const shown = new Set([refKey({ book: "John", chapter: 3, verse: 16 })]);
    const out = dedupeAgainstShown([HIT_JOHN, HIT_1COR], shown);
    assert.equal(out.length, 1);
    assert.equal(out[0].book, "1 Corinthians");
  });
  await check("book-name casing does not defeat the dedupe", () => {
    const out = dedupeAgainstShown([{ ...HIT_JOHN, book: "JOHN" }], new Set([refKey({ book: "John", chapter: 3, verse: 16 })]));
    assert.equal(out.length, 0);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
void main();
