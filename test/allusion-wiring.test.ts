/**
 * Allusion v1 wiring: flag, runtime decisions, state reducer, detectAll parity,
 * and flag-OFF parity of the useAudioStream call sites.
 * Run: npx tsx test/allusion-wiring.test.ts
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { decodeAllusionIndex, type AllusionIndexJson } from "../src/lib/ai-detection/allusion-matcher";
import {
  allusionV1Enabled, ALLUSION_V1_STORAGE_KEY, createAllusionRuntime, decideAllusion,
  applyAllusionToState, runAllusionOnFinal,
} from "../src/lib/ai-detection/allusion-runtime";
import { buildIndex } from "../src/lib/ai-detection/lyric-fragment";
import { detectAll, _resetPhraseCooldown, type DetectAllContext } from "../src/lib/ai-detection";
import type { PhraseMatch, UnifiedSuggestion } from "../src/components/operator/useAudioStream";

let pass = 0, fail = 0;
async function check(name: string, fn: () => unknown) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n         ${(e as Error).message}`); fail++; }
}

const ROOT = path.join(__dirname, "..");
const index = decodeAllusionIndex(JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/allusion-index.generated.json"), "utf8")) as AllusionIndexJson);
const PS = "Surely goodness and mercy shall follow me all the days of my life";

// minimal localStorage stub
const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = { localStorage: { getItem: (k: string) => store.get(k) ?? null } };

async function main() {
  console.log("Allusion v1 wiring");

  await check("flag: default ON; localStorage '0' disables live; env '0' disables", () => {
    store.clear(); delete process.env.NEXT_PUBLIC_ALLUSION_V1;
    assert.strictEqual(allusionV1Enabled(), true);
    store.set(ALLUSION_V1_STORAGE_KEY, "0"); assert.strictEqual(allusionV1Enabled(), false);
    store.set(ALLUSION_V1_STORAGE_KEY, "1"); assert.strictEqual(allusionV1Enabled(), true);
    store.clear(); process.env.NEXT_PUBLIC_ALLUSION_V1 = "0"; assert.strictEqual(allusionV1Enabled(), false);
    delete process.env.NEXT_PUBLIC_ALLUSION_V1;
  });

  await check("runtime: emits nothing until the index is loaded", () => {
    const ref = { current: createAllusionRuntime() };
    ref.current.loading = true; // pretend a load is in flight
    let calls = 0;
    runAllusionOnFinal(ref, "seg1", PS, {}, null, () => { calls++; });
    assert.strictEqual(calls, 0);
  });

  await check("runtime: quote → suggestion (isPhraseMatch, ≤74) + cross-ref row", () => {
    const rt = createAllusionRuntime(index);
    const hit = decideAllusion(rt, PS, { mode: "auto" }, null, 1_000);
    assert.ok(hit, "expected a hit");
    const s = applyAllusionToState({ phraseMatches: [] as PhraseMatch[], suggestions: [] as UnifiedSuggestion[] }, "seg1", hit!, 1_000);
    const sug = s.suggestions[0];
    assert.ok(sug.type === "scripture" && sug.isPhraseMatch === true && sug.confidence <= 74);
    assert.strictEqual(sug.type === "scripture" && `${sug.ref.book} ${sug.ref.chapter}:${sug.ref.verseStart}`, "Psalms 23:6");
    assert.strictEqual(s.phraseMatches.length, 1);
    assert.deepStrictEqual(s.phraseMatches[0].candidates.map((c) => `${c.book} ${c.chapter}:${c.verse}`), ["Psalms 23:6"]);
    assert.ok(s.phraseMatches[0].candidates[0].similarity <= 74);
  });

  await check("abstain: worship mode", () => {
    assert.strictEqual(decideAllusion(createAllusionRuntime(index), PS, { mode: "worship" }, null, 1), null);
  });
  await check("abstain: verse already live (reference footer)", () => {
    assert.strictEqual(decideAllusion(createAllusionRuntime(index), PS, { liveText: "Surely goodness… Psalms 23:6 (KJV)" }, null, 1), null);
  });
  const songs = buildIndex([{ songId: "s1", title: "Goodness", source: "church", slides: [{ order: 0, lyrics: "Surely goodness and mercy shall follow me all the days of my life" }] }]);
  await check("abstain: quote is a lyric in the loaded song library", () => {
    assert.strictEqual(decideAllusion(createAllusionRuntime(index), PS, {}, songs, 1), null);
  });
  await check("abstain: a song is live (live text matches the library)", () => {
    const other = buildIndex([{ songId: "s2", title: "Way Maker", source: "church", slides: [{ order: 0, lyrics: "way maker miracle worker promise keeper light in the darkness" }] }]);
    const rt = createAllusionRuntime(index);
    assert.strictEqual(decideAllusion(rt, PS, { liveText: "way maker miracle worker promise keeper light in the darkness" }, other, 1), null);
    assert.ok(decideAllusion(createAllusionRuntime(index), PS, { liveText: "Welcome to church" }, other, 1));
  });
  await check("abstain: explicit reference in the segment (parser owns it)", () => {
    assert.strictEqual(decideAllusion(createAllusionRuntime(index), `Psalm 23 verse 6 says ${PS}`, {}, null, 1), null);
  });
  await check("passage context: live Daniel 4 verse enables continuous reading", () => {
    const seg = "At the same time, my reason returned unto me and for the glory of my kingdom.";
    const withLive = decideAllusion(createAllusionRuntime(index), seg, { liveText: "…returned unto me. Daniel 4:35 (KJV)" }, null, 1);
    assert.strictEqual(withLive?.ref, "Daniel 4:36");
  });

  // ── detectAll parity: skipPhraseFallback absent === previous behaviour ──
  const ctx: DetectAllContext = { churchId: "t", hasVerseContext: false, hasSlideContext: false, hasSongContext: false };
  await check("detectAll: flag OFF (no skipPhraseFallback) still yields curated phrase chip", async () => {
    _resetPhraseCooldown();
    const r = await detectAll("for God so loved the world", ctx);
    assert.ok(r.scripture.some((s) => s.isPhraseMatch), "expected curated phrase match");
  });
  await check("detectAll: skipPhraseFallback:false is identical to absent", async () => {
    _resetPhraseCooldown();
    const a = await detectAll("for God so loved the world", ctx);
    _resetPhraseCooldown();
    const b = await detectAll("for God so loved the world", { ...ctx, skipPhraseFallback: false });
    assert.deepStrictEqual(b, a);
  });
  await check("detectAll: flag ON skips curated topPhraseForSpeech chips, keeps explicit refs", async () => {
    _resetPhraseCooldown();
    const r = await detectAll("for God so loved the world", { ...ctx, skipPhraseFallback: true });
    assert.ok(!r.scripture.some((s) => s.isPhraseMatch));
    const e = await detectAll("turn to John 3:16", { ...ctx, skipPhraseFallback: true });
    assert.ok(e.scripture.some((s) => s.book === "John" && s.chapter === 3 && s.verseStart === 16));
  });

  // ── flag-OFF parity of the hook call sites (source contract) ──
  await check("useAudioStream: every allusion call site is flag-gated; OFF path unchanged", () => {
    const src = fs.readFileSync(path.join(ROOT, "src/components/operator/useAudioStream.ts"), "utf8");
    assert.ok(src.includes(`else if (msg.type === "phrase_matches" && !allusionV1Enabled()) setState((s) => ({`), "server phrase_matches must be ignored only when ON");
    assert.ok(src.includes("...(allusionV1Enabled() ? { skipPhraseFallback: true } : {})"), "detectAll ctx must be unchanged when OFF");
    const calls = src.split("runAllusionOnFinal(").length - 1;
    assert.strictEqual(calls, 1, "exactly one matcher call site");
    assert.ok(/if \(allusionV1Enabled\(\) && typeof msg\.text === "string"\) \{[^\n]*setTimeout\(\(\) => runAllusionOnFinal\(/.test(src), "matcher call must be flag-gated and deferred");
    const finalAt = src.indexOf('else if (msg.type === "final")');
    assert.ok(finalAt > 0 && src.indexOf("runDetectAll(msg.segmentId, msg.text", finalAt) < src.indexOf("runAllusionOnFinal(", finalAt), "explicit detection must run before the allusion matcher");
    assert.ok(!/scripts\/audio-server/.test(src));
  });
  await check("audio-server untouched: still emits phrase_matches", () => {
    const srv = fs.readFileSync(path.join(ROOT, "scripts/audio-server.ts"), "utf8");
    assert.ok(srv.includes("phrase_matches"));
  });
  await check("auto-fire exclusion intact: shell filters !isPhraseMatch", () => {
    const shell = fs.readFileSync(path.join(ROOT, "src/components/operator/pro/ProOperatorShell.tsx"), "utf8");
    assert.ok(shell.includes(`s.type === "scripture" && !s.isPhraseMatch && s.confidence >= BIBLE_AUTOFIRE_CONFIDENCE`));
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main();
