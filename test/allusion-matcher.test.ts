/**
 * Precision-first allusion matcher (v1) — pure unit tests against the real generated index.
 * Run: npx tsx test/allusion-matcher.test.ts
 *
 * Wiring + flag-OFF parity live in test/allusion-wiring.test.ts.
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import {
  decodeAllusionIndex, matchAllusion, createAllusionState, ALLUSION_CONFIG,
  type AllusionContext, type AllusionIndexJson,
} from "../src/lib/ai-detection/allusion-matcher";
import { allusionContentWords } from "../src/lib/ai-detection/allusion-normalize";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n         ${(e as Error).message}`); fail++; }
}

const index = decodeAllusionIndex(JSON.parse(fs.readFileSync(path.join(__dirname, "../src/data/allusion-index.generated.json"), "utf8")) as AllusionIndexJson);

/** Feed segments 3s apart into a fresh state; return every emitted ref. */
function feed(segs: string[], ctx: Partial<AllusionContext> = {}, t0 = 1_000_000): string[] {
  const st = createAllusionState();
  const out: string[] = [];
  segs.forEach((s, i) => {
    const m = matchAllusion(index, st, s, { nowMs: t0 + i * 3000, ...ctx });
    if (m) out.push(m.ref);
  });
  return out;
}

console.log("Allusion matcher v1");

// ── normaliser ──
check("normaliser folds archaic KJV forms onto modern speech", () => {
  assert.deepStrictEqual(allusionContentWords("he doeth according to his will"), allusionContentWords("he does according to his will"));
  assert.deepStrictEqual(allusionContentWords("mine honour and brightness returned unto me"), allusionContentWords("Mine honor and brightness returned unto me."));
});

// ── positives ──
check("KJV near-verbatim: Psalm 23:6", () => {
  assert.deepStrictEqual(feed(["Surely goodness and mercy shall follow me all the days of my life"]), ["Psalms 23:6"]);
});
check("modern wording: Isaiah 40:31", () => {
  assert.deepStrictEqual(feed(["For bible says those who wait on the lord they renew strength. They are able to mount up with wings as eagles."]), ["Isaiah 40:31"]);
});
check("quote split across two final segments: Daniel 4:35", () => {
  const got = feed(["And all the inhabitants of the earth are reputed as nothing.", "And he doeth according to his will in the army of heaven."]);
  assert.deepStrictEqual(got, ["Daniel 4:35"]);
});
// Proverbs 22:6 ("train up a child in the way…") deliberately no longer emits: child/way are
// high-frequency Bible words, so it lacks distinctive evidence (accepted recall loss, 2026-09-15).
check("near-verbatim quote with no reference: Daniel 4:29", () => {
  assert.deepStrictEqual(feed(["At the end of twelve months he walked in the palace of the kingdom of Babylon."]), ["Daniel 4:29"]);
});
check("confidence is display-only and never reaches the 75 auto-fire bar", () => {
  const st = createAllusionState();
  const m = matchAllusion(index, st, "Surely goodness and mercy shall follow me all the days of my life", { nowMs: 1 });
  assert.ok(m && m.confidence <= 74, `confidence ${m?.confidence}`);
});

// ── hard negatives ──
for (const s of [
  "That", "God", "Amen.", "Praise God.",
  "In Jesus' mighty name we have prayed. Father in Jesus name, amen.",
  "We want to give God the praise. Give God the praise.",
  "Thank you, Lord. Just say the Lord thank you. Thank you, Jesus.",
  "Daniel and his 3 friends refused to eat the king's food.",
  "Can you put the lyrics on the screen please? Next slide. Mic 2 is too loud.",
  "It's time for tithes and offerings. If you have your tithes, please come forward.",
]) {
  check(`negative: ${JSON.stringify(s.slice(0, 50))}`, () => assert.deepStrictEqual(feed([s]), []));
}

// ── abstain rules ──
const PS = "Surely goodness and mercy shall follow me all the days of my life";
check("worship mode abstains (sung lyric quoting scripture)", () => assert.deepStrictEqual(feed([PS], { mode: "worship" }), []));
check("song live abstains", () => assert.deepStrictEqual(feed([PS], { songLive: true }), []));
check("song-library lyric match abstains", () => assert.deepStrictEqual(feed([PS], { lyricMatch: true }), []));
check("explicit reference in window abstains (parser owns it)", () => assert.deepStrictEqual(feed([PS], { explicitRefInWindow: true }), []));
check("verse already live abstains", () => assert.deepStrictEqual(feed([PS], { liveRef: { book: "Psalms", chapter: 23, verse: 6 } }), []));
check("preacher mode still matches", () => assert.deepStrictEqual(feed([PS], { mode: "preacher" }), ["Psalms 23:6"]));
check("same verse is not re-emitted within 60s, but is after", () => {
  const st = createAllusionState();
  assert.ok(matchAllusion(index, st, PS, { nowMs: 0 }));
  assert.strictEqual(matchAllusion(index, st, PS, { nowMs: 30_000 }), null);
  assert.ok(matchAllusion(index, st, PS, { nowMs: 30_000 + ALLUSION_CONFIG.DEDUPE_MS + 1 }));
});
check("stale words (>20s old) cannot complete a match with new words", () => {
  const st = createAllusionState();
  matchAllusion(index, st, "And all the inhabitants of the earth are reputed as nothing.", { nowMs: 0 });
  assert.strictEqual(matchAllusion(index, st, "the army of heaven.", { nowMs: 60_000 }), null);
});
check("continuous reading: announced passage relaxes coverage only inside that chapter", () => {
  const seg = "At the same time, my reason returned unto me and for the glory of my kingdom.";
  const withCtx = feed([seg], { passage: { book: "Daniel", chapter: 4, verse: 34, atMs: 1_000_000 } });
  assert.deepStrictEqual(withCtx, ["Daniel 4:36"]);
  const otherChapter = feed([seg], { passage: { book: "Daniel", chapter: 7, verse: 1, atMs: 1_000_000 } });
  assert.deepStrictEqual(otherChapter, feed([seg]));
});

// ── performance budget ──
check("performance: < 1ms per call on average over 2,000 segments", () => {
  const st = createAllusionState();
  const lines = [PS, "We thank God for another week in his presence and we give him all the glory.", "Please turn to your neighbour and say welcome to church."];
  const t = performance.now();
  for (let i = 0; i < 2000; i++) matchAllusion(index, st, lines[i % 3], { nowMs: i * 3000 });
  const avg = (performance.now() - t) / 2000;
  assert.ok(avg < 1, `avg ${avg.toFixed(3)}ms`);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
