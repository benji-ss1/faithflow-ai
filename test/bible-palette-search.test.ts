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
import { readFileSync } from "node:fs";
import { defaultFilter } from "cmdk";
import {
  createBiblePaletteSearcher,
  gateByLexical,
  fastPathShownKeys,
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


  // ── Review fix 1: group order + tie resolution ─────────────────────────────
  console.log("Palette group order (songs before Bible verses):");
  const paletteSrc = readFileSync(new URL("../src/components/operator/pro/SearchPalette.tsx", import.meta.url), "utf8");
  await check("Bible Verses group is rendered AFTER Songs and Lyrics", () => {
    const iSongs = paletteSrc.indexOf('>Songs</span>');
    const iLyrics = paletteSrc.indexOf('>Lyrics</span>');
    const iVerses = paletteSrc.indexOf('>Bible Verses</span>');
    assert.ok(iSongs > 0 && iLyrics > 0 && iVerses > 0, "all three groups present");
    assert.ok(iSongs < iVerses, "Songs before Bible Verses");
    assert.ok(iLyrics < iVerses, "Lyrics before Bible Verses");
  });
  await check("verse items no longer inject the raw query into their cmdk value", () => {
    assert.ok(!/value=\{`verse \$\{query\}/.test(paletteSrc), "raw-query injection removed");
    assert.ok(/forceMount/.test(paletteSrc), "forceMount keeps semantic hits from being filtered out");
  });
  await check('"way maker": cmdk selects the SONG, not a verse', () => {
    // cmdk sorts groups by their max item score, ties by DOM order, and
    // auto-selects the first item. Reproduce that with cmdk's real filter.
    const songScore = defaultFilter!("song Way Maker Sinach", "way maker", []);
    const verseScore = defaultFilter!("verse Proverbs 30:19", "way maker", []);
    assert.ok(songScore > verseScore, `song ${songScore} must outrank verse ${verseScore}`);
    // ...and the old value shape is exactly what broke it:
    const oldVerseScore = defaultFilter!("verse way maker Proverbs 30:19", "way maker", []);
    assert.ok(oldVerseScore > songScore, "regression guard: the old injected value DID outrank the song");
  });

  // ── Review fix 2: lexical relevance gate ───────────────────────────────────
  console.log("Lexical relevance gate:");
  const LEX: BiblePaletteHit = { ...HIT_1COR, lexical: true, semantic: false };
  const SEM: BiblePaletteHit = { ...HIT_JOHN, lexical: false, semantic: true };
  await check("lexicalAvailable + a lexical hit → group renders, lexical first", () => {
    const out = gateByLexical([SEM, LEX], true);
    assert.equal(out.length, 2);
    assert.equal(out[0].book, "1 Corinthians");
  });
  await check("lexicalAvailable + NO lexical hit (gibberish) → group hidden", () => {
    assert.deepEqual(gateByLexical([SEM], true), []);
  });
  await check("FTS index down (lexicalAvailable false) → ungated fallback, group still shows", () => {
    const out = gateByLexical([SEM], false);
    assert.equal(out.length, 1, "must NOT silently hide the Bible group everywhere");
  });
  await check("searcher applies the gate off the server flag", async () => {
    _clearBibleSearchCache();
    let got: BiblePaletteHit[] = [];
    const fetchGibberish = async () => ({ ok: true, json: async () => ({ hits: [SEM], lexicalAvailable: true }) });
    const s1 = createBiblePaletteSearcher({ onResults: (_q, h) => { got = h; }, fetchImpl: fetchGibberish, debounceMs: 10 });
    s1.search("asdfgh qwerty zxcv"); await sleep(60);
    assert.deepEqual(got, [], "gibberish renders no Bible group");
    _clearBibleSearchCache();
    const fetchNoFts = async () => ({ ok: true, json: async () => ({ hits: [SEM], lexicalAvailable: false }) });
    const s2 = createBiblePaletteSearcher({ onResults: (_q, h) => { got = h; }, fetchImpl: fetchNoFts, debounceMs: 10 });
    s2.search("asdfgh qwerty zxcv"); await sleep(60);
    assert.equal(got.length, 1, "no FTS index → fall back to previous behaviour");
  });

  // ── Review fix 4: 429 is not "no verses found" ─────────────────────────────
  console.log("Rate-limited / failed search:");
  await check("a 429 reports busy and is NOT cached as an empty result", async () => {
    _clearBibleSearchCache();
    let calls = 0;
    let status: string | undefined;
    const fetch429 = async () => { calls++; return { ok: false, json: async () => ({ error: "Too many searches" }) }; };
    const s = createBiblePaletteSearcher({ onResults: (_q, _h, st) => { status = st; }, fetchImpl: fetch429, debounceMs: 10 });
    s.search("love is patient"); await sleep(60);
    assert.equal(status, "busy", "palette can show 'Bible search is busy'");
    s.search("love is patient"); await sleep(60);
    assert.equal(calls, 2, "an error must never be cached as a result");
  });

  // ── Review fix 1 (final pass): forceMounted group vs Command.Empty ─────────
  console.log("\"No results.\" never renders above a populated Bible group:");
  await check("Command.Empty is gated on the forceMounted Bible group being empty", () => {
    assert.ok(
      /bibleVerseHits\.length === 0 && \(\s*<Command\.Empty/.test(paletteSrc.replace(/\{\/\*[\s\S]*?\*\/\}/g, "")),
      "Command.Empty must be gated on bibleVerseHits.length === 0",
    );
  });
  await check("a query with ONLY Bible hits shows no 'No results.' line", () => {
    // cmdk's filtered.count ignores forceMounted items, so the component's own
    // gate is the only thing standing between the operator and a contradiction.
    const emptyShown = (bibleVerseHitCount: number, cmdkFilteredCount: number) =>
      cmdkFilteredCount === 0 && bibleVerseHitCount === 0;
    assert.equal(emptyShown(5, 0), false, "5 verses listed → no 'No results.'");
    assert.equal(emptyShown(0, 0), true, "genuinely nothing → 'No results.' still shows");
    assert.equal(emptyShown(0, 3), false);
  });

  // ── Review fix 2 (final pass): COMMON_REFS must not suppress invisibly ─────
  console.log("Fast-path dedupe only suppresses VISIBLE common refs:");
  const score = (v: string, q: string) => defaultFilter!(v, q, []);
  const COMMON = ["John 3:16", "Philippians 4:13", "Psalm 23:1"];
  await check('"i can do all things" surfaces Phil 4:13 from exactly ONE group', () => {
    const q = "i can do all things";
    assert.equal(score("bible Philippians 4:13", q), 0, "premise: the common-ref item is filtered out");
    const keys = fastPathShownKeys(q, COMMON, [], score);
    const hit: BiblePaletteHit = { book: "Philippians", chapter: 4, verse: 13, text: "I can do all things through Christ…", lexical: true };
    const out = dedupeAgainstShown([hit], keys);
    assert.equal(out.length, 1, "an invisible common ref must not suppress the server hit");
  });
  await check("a VISIBLE common ref still suppresses the duplicate", () => {
    const q = "john 3:16";
    assert.ok(score("bible John 3:16", q) > 0, "premise: the common-ref item renders");
    const keys = fastPathShownKeys(q, COMMON, [], score);
    assert.deepEqual(dedupeAgainstShown([HIT_JOHN], keys), [], "no double-listing");
  });
  await check("phrase-corpus keys always suppress (their items are not filtered the same way)", () => {
    const keys = fastPathShownKeys("anything", COMMON, [refKey({ book: "John", chapter: 3, verse: 16 })], score);
    assert.deepEqual(dedupeAgainstShown([HIT_JOHN], keys), []);
  });
  await check("empty query keeps every common ref seeded (cmdk shows them all)", () => {
    const keys = fastPathShownKeys("", COMMON, [], score);
    assert.equal(keys.size, 3);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
void main();
