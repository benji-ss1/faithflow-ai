/**
 * Allusion v1 runtime: per-call translation code + pipeline-generation guard.
 * Run: npx tsx test/allusion-runtime-guards.test.ts
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { decodeAllusionIndex, type AllusionIndexJson, type AllusionMatch } from "../src/lib/ai-detection/allusion-matcher";
import { createAllusionRuntime, runAllusionOnFinal } from "../src/lib/ai-detection/allusion-runtime";
import type { PhraseMatch, UnifiedSuggestion } from "../src/components/operator/useAudioStream";

let pass = 0, fail = 0;
async function check(name: string, fn: () => unknown) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n         ${(e as Error).message}`); fail++; }
}
(globalThis as unknown as { window: unknown }).window = { localStorage: { getItem: () => null } };
const index = decodeAllusionIndex(JSON.parse(fs.readFileSync(path.join(__dirname, "../src/data/allusion-index.generated.json"), "utf8")) as AllusionIndexJson);
const PS = "Surely goodness and mercy shall follow me all the days of my life";
type St = { phraseMatches: PhraseMatch[]; suggestions: UnifiedSuggestion[] };
const tick = () => new Promise((r) => setTimeout(r, 10));

function harness() {
  let state: St = { phraseMatches: [], suggestions: [] };
  const setState = (fn: (p: St) => St) => { state = fn(state); };
  return { get: () => state, setState, ref: { current: createAllusionRuntime(index) } };
}

async function main() {
  console.log("Allusion runtime guards");

  await check("translation code passed per call is used for the rail verse text", async () => {
    const codes: string[] = [];
    const lookup = async (_h: AllusionMatch, code: string) => { codes.push(code); return `text-${code}`; };
    const h = harness();
    runAllusionOnFinal(h.ref, "s1", PS, { translationCode: "NIV" }, null, h.setState, () => true, lookup);
    await tick();
    assert.deepStrictEqual(codes, ["NIV"]);
    assert.strictEqual(h.get().phraseMatches[0].candidates[0].text, "text-NIV");
    const h2 = harness();
    runAllusionOnFinal(h2.ref, "s2", PS, { translationCode: "ESV" }, null, h2.setState, () => true, lookup);
    await tick();
    assert.strictEqual(codes[1], "ESV");
  });

  await check("lookup failure in the session translation falls back to KJV", async () => {
    const codes: string[] = [];
    const lookup = async (_h: AllusionMatch, code: string) => { codes.push(code); if (code !== "KJV") throw new Error("x"); return "kjv"; };
    const h = harness();
    runAllusionOnFinal(h.ref, "s1", PS, { translationCode: "NIV" }, null, h.setState, () => true, lookup);
    await tick();
    assert.deepStrictEqual(codes, ["NIV", "KJV"]);
    assert.strictEqual(h.get().phraseMatches[0].candidates[0].text, "kjv");
  });

  await check("generation changed before the match → nothing applied", async () => {
    const h = harness();
    runAllusionOnFinal(h.ref, "s1", PS, {}, null, h.setState, () => false, async () => "t");
    await tick();
    assert.strictEqual(h.get().suggestions.length, 0);
    assert.strictEqual(h.get().phraseMatches.length, 0);
  });

  await check("generation changed during the async verse-text fill → fill skipped", async () => {
    let gen = 1;
    const h = harness();
    let release!: (v: string) => void;
    const lookup = () => new Promise<string>((r) => { release = r; });
    runAllusionOnFinal(h.ref, "s1", PS, {}, null, h.setState, () => gen === 1, lookup);
    assert.strictEqual(h.get().phraseMatches.length, 1);
    gen = 2; // stop / restart / plan change
    release("late text");
    await tick();
    assert.strictEqual(h.get().phraseMatches[0].candidates[0].text, "");
  });

  await check("useAudioStream captures the generation when scheduling the deferred matcher", () => {
    const src = fs.readFileSync(path.join(__dirname, "../src/components/operator/useAudioStream.ts"), "utf8");
    assert.ok(src.includes("gen = pipelineGenerationRef.current; const isCurrent = () => gen === pipelineGenerationRef.current;"));
    assert.ok(/setTimeout\(\(\) => \{ if \(isCurrent\(\)\) runAllusionOnFinal\([^\n]*setState, isCurrent\); \}, 0\)/.test(src));
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main();
