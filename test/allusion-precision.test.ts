/**
 * Allusion v1 precision fixes (held-out review 2026-09-15): A names-as-topic,
 * B passage precedence (NT quoting OT), C everyday phrases, D prayer context,
 * plus wiring fixes 1-4 (non-DOM parts).
 * Run: npx tsx test/allusion-precision.test.ts
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import {
  decodeAllusionIndex, decodeAllusionIndexChunked, matchAllusion, createAllusionState,
  type AllusionIndexJson, type AllusionContext,
} from "../src/lib/ai-detection/allusion-matcher";
import {
  applyAllusionToState, createAllusionRuntime, warmAllusionIndex,
  ALLUSION_SUGGESTIONS_CAP, ALLUSION_LOAD_RETRY_MS,
} from "../src/lib/ai-detection/allusion-runtime";
import type { PhraseMatch, UnifiedSuggestion } from "../src/components/operator/useAudioStream";

let pass = 0, fail = 0;
async function check(name: string, fn: () => unknown) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n         ${(e as Error).message}`); fail++; }
}
const json = JSON.parse(fs.readFileSync(path.join(__dirname, "../src/data/allusion-index.generated.json"), "utf8")) as AllusionIndexJson;
const index = decodeAllusionIndex(json);
function feed(segs: string[], ctx: Partial<AllusionContext> = {}, t0 = 1_000_000, dt = 3000): (string | null)[] {
  const st = createAllusionState();
  return segs.map((s, i) => matchAllusion(index, st, s, { nowMs: t0 + i * dt, ...ctx })?.ref ?? null);
}

async function main() {
  console.log("Allusion v1 precision fixes");

  // A — names/places are topic, not quotation
  await check("A: name list built from Bible capitalisation + books (versioned)", () => {
    for (const n of ["mos", "egypt", "israel", "david", "pharaoh", "jerusalem"]) assert.ok(index.names.has(n), n);
    for (const n of ["listen", "part", "god"]) assert.ok(!index.names.has(n), n);
    assert.ok(/-p\d+$/.test(index.version), index.version);
  });
  await check("A: narrative with shared names/places does not emit (Moses / Red Sea)", () => {
    assert.deepStrictEqual(feed(["We have Moses. He went to Pharaoh in Egypt and he saw the Red Sea being parted."]).filter(Boolean), []);
  });
  await check("A: genuine quote with names still emits when non-name evidence is strong", () => {
    assert.deepStrictEqual(feed(["At the end of twelve months he walked in the palace of the kingdom of Babylon."]).filter(Boolean), ["Daniel 4:29"]);
  });

  // B — passage precedence
  await check("B: while Romans 8 is being read, its quote of Psalm 44:22 is NOT suggested as the Psalm", () => {
    const got = feed(["As it is written, for your sake, are killed all the day long. We are counted as sheep for slaughter."],
      { passage: { book: "Romans", chapter: 8, verse: 31, atMs: 1_000_000 - 80_000 } }).filter(Boolean);
    assert.ok(!got.includes("Psalms 44:22"), JSON.stringify(got));
    assert.ok(got.length === 0 || got[0] === "Romans 8:36", JSON.stringify(got));
  });
  await check("B: without a passage the Psalm may emit (precedence is context-only)", () => {
    const st = createAllusionState();
    const r = matchAllusion(index, st, "Yea for thy sake are we killed all the day long we are counted as sheep for the slaughter", { nowMs: 1 });
    assert.ok(r === null || r.ref === "Psalms 44:22" || r.ref === "Romans 8:36");
  });

  // C — everyday phrases
  for (const s of ["Listen. Listen. Pay attention.", "Don't lean on your own understanding, trust the Lord completely", "Come on, stand up and give him a clap"]) {
    await check(`C: everyday phrase does not emit: ${JSON.stringify(s)}`, () => assert.deepStrictEqual(feed([s]).filter(Boolean), []));
  }
  await check("C: a genuine quote still emits (Daniel 4:29)", () => {
    assert.deepStrictEqual(feed(["At the end of twelve months he walked in the palace of the kingdom of Babylon."]).filter(Boolean), ["Daniel 4:29"]);
  });

  // D — prayer context
  await check("D: short-tier match right after prayer markers is suppressed", () => {
    const got = feed(["Father Lord, we worship you, we exalt you, we give you praise", "for all that you have done for us",
      "for seeing us through, walking us through the valley of the shadows of death."]).filter(Boolean);
    assert.deepStrictEqual(got, []);
  });
  await check("D: strict evidence still emits after a prayer (Psalm 23:6 benediction)", () => {
    const got = feed(["in Jesus name, amen.", "Surely goodness and mercy shall follow me all the days of my life"]).filter(Boolean);
    assert.deepStrictEqual(got, ["Psalms 23:6"]);
  });

  // Fixes 1-3 — state reducer
  const hit = matchAllusion(index, createAllusionState(), "Surely goodness and mercy shall follow me all the days of my life", { nowMs: 1 })!;
  const base = { phraseMatches: [] as PhraseMatch[], suggestions: [] as UnifiedSuggestion[] };
  await check("1: an explicit (non-phrase) suggestion for the same verse is never replaced", () => {
    const explicit: UnifiedSuggestion = { id: "sc-x", type: "scripture", segmentId: "x", ts: 0, confidence: 92, matchedText: "Psalm 23:6", ref: { book: "Psalms", chapter: 23, verseStart: 6, verseEnd: 6 } };
    const s = applyAllusionToState({ ...base, suggestions: [explicit] }, "seg", hit, 5);
    assert.strictEqual(s.suggestions.length, 1);
    assert.strictEqual(s.suggestions[0], explicit);
  });
  await check("3: the same verse quoted again → one rail group (refreshed ts, text kept)", () => {
    let s = applyAllusionToState(base, "a", hit, 1);
    s = { ...s, phraseMatches: s.phraseMatches.map((g) => ({ ...g, candidates: g.candidates.map((c) => ({ ...c, text: "Surely goodness…" })) })) };
    s = applyAllusionToState(s, "b", hit, 99);
    assert.strictEqual(s.phraseMatches.length, 1);
    assert.strictEqual(s.phraseMatches[0].ts, 99);
    assert.strictEqual(s.phraseMatches[0].candidates[0].text, "Surely goodness…");
    assert.strictEqual(s.suggestions.length, 1);
  });
  await check("3: suggestions trimmed to the 40 cap", () => {
    const many = Array.from({ length: 60 }, (_, i): UnifiedSuggestion => ({ id: `s${i}`, type: "scripture", segmentId: "x", ts: 0, confidence: 80, matchedText: "", ref: { book: "John", chapter: 1, verseStart: i + 1, verseEnd: i + 1 } }));
    assert.strictEqual(applyAllusionToState({ ...base, suggestions: many }, "seg", hit, 1).suggestions.length, ALLUSION_SUGGESTIONS_CAP);
  });

  // Fix 4 — loading
  await check("4d: chunked decode yields and equals the sync decode", async () => {
    let yields = 0;
    const ix = await decodeAllusionIndexChunked(json, async () => { yields++; });
    assert.ok(yields >= 3);
    assert.strictEqual(ix.hashes.length, index.hashes.length);
    assert.deepStrictEqual(Array.from(ix.canon.slice(0, 50)), Array.from(index.canon.slice(0, 50)));
    assert.strictEqual(ix.names.size, index.names.size);
  });
  await check("4e: a failed load retries at most once per 60s", async () => {
    const rt = createAllusionRuntime();
    let calls = 0;
    const failing = () => { calls++; return Promise.reject(new Error("x")); };
    warmAllusionIndex(rt, failing, 0);
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(calls, 1);
    warmAllusionIndex(rt, failing, rt.lastFailAt + 1000);
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(calls, 1, "no retry inside the window");
    warmAllusionIndex(rt, failing, rt.lastFailAt + ALLUSION_LOAD_RETRY_MS + 1);
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(calls, 2);
  });
  await check("4c: after a successful load, the index is set and a warm-up runs without throwing", async () => {
    const rt = createAllusionRuntime();
    warmAllusionIndex(rt, () => Promise.resolve(index), 0);
    await new Promise((r) => setTimeout(r, 30));
    assert.strictEqual(rt.index, index);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main();
