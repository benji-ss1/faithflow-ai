/**
 * Bible auto-fire anti-replay guard tests (2026-07-30 policy).
 *
 * Run: npx tsx --env-file=.env.local test/bible-antireplay.test.ts
 *
 * Covers the pure decision helper in src/lib/bible-antireplay.ts —
 * confirms the field-report scenarios that motivated the switch from a
 * 5-minute session-persistent suppression to a 3-second micro-cooldown:
 *
 *   - Matt 5:5 → wait 4s → Matt 5:5 : MUST re-fire
 *   - Matt 5:5 same-utterance duplicate detection : MUST suppress
 *   - Matt 5:5 → Gen 4:4 currently live → Matt 5:5 : MUST fire immediately
 *   - Matt 5:5 → 5 other verses live → Matt 5:5 : MUST fire
 *   - forceLive / voiceCommand always bypass the guard
 *   - non-scripture live (song lyric, image, blank, empty) is treated as
 *     "different reference" so the swap-back bypass fires
 *
 * Uses plain node:assert (matching test/projector-output.test.ts).
 */
import assert from "node:assert";
import {
  BIBLE_MICRO_COOLDOWN_MS,
  decideBibleAutoFire,
  isDifferentRefLive,
  parseLiveScriptureRef,
} from "../src/lib/bible-antireplay";

let pass = 0;
let fail = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn())
    .then(() => { console.log(`  PASS  ${name}`); pass++; })
    .catch((e) => { console.error(`  FAIL  ${name}\n         ${(e as Error).message}`); fail++; });
}

const matt5_5 = { book: "Matthew", chapter: 5, verseStart: 5, verseEnd: 5 };
const gen4_4 = { book: "Genesis", chapter: 4, verseStart: 4, verseEnd: 4 };
const psalm23_4 = { book: "Psalm", chapter: 23, verseStart: 4, verseEnd: 4 };
const mattKey = "matt-5-5-kjv"; // stable per-reference key (shape mirrors first.id)
const genKey = "gen-4-4-kjv";
const psalmKey = "psalm-23-4-kjv";

function liveScripture(book: string, ch: number, v: number, code = "KJV"): string {
  return `some verse body text\n\n${book} ${ch}:${v} (${code})`;
}

async function main() {
  console.log("Bible auto-fire anti-replay (3s micro-cooldown)");
  console.log(`  BIBLE_MICRO_COOLDOWN_MS = ${BIBLE_MICRO_COOLDOWN_MS}`);

  // ── Cooldown constant ────────────────────────────────────────────────────
  await check("cooldown constant is exactly 3000ms (the 2026-07-30 policy)", () => {
    assert.strictEqual(BIBLE_MICRO_COOLDOWN_MS, 3000);
  });

  // ── parseLiveScriptureRef ────────────────────────────────────────────────
  await check("parseLiveScriptureRef: standard Bible-verse label", () => {
    const parsed = parseLiveScriptureRef("For God so loved the world\n\nJohn 3:16 (KJV)");
    assert.deepStrictEqual(parsed, { book: "john", chapter: 3, verseStart: 16, verseEnd: 16 });
  });

  await check("parseLiveScriptureRef: verse range label", () => {
    const parsed = parseLiveScriptureRef("Body\n\nMatthew 5:3-12 (NIV)");
    assert.deepStrictEqual(parsed, { book: "matthew", chapter: 5, verseStart: 3, verseEnd: 12 });
  });

  await check("parseLiveScriptureRef: numbered book (1 John, 2 Corinthians)", () => {
    const parsed = parseLiveScriptureRef("Body\n\n1 John 4:8 (KJV)");
    assert.deepStrictEqual(parsed, { book: "1 john", chapter: 4, verseStart: 8, verseEnd: 8 });
  });

  await check("parseLiveScriptureRef: song lyric returns null", () => {
    assert.strictEqual(parseLiveScriptureRef("Amazing grace how sweet the sound"), null);
  });

  await check("parseLiveScriptureRef: empty / null returns null", () => {
    assert.strictEqual(parseLiveScriptureRef(""), null);
    assert.strictEqual(parseLiveScriptureRef(null), null);
    assert.strictEqual(parseLiveScriptureRef(undefined), null);
  });

  // ── isDifferentRefLive ───────────────────────────────────────────────────
  await check("isDifferentRefLive: same ref live → false (guard stays active)", () => {
    assert.strictEqual(isDifferentRefLive(liveScripture("Matthew", 5, 5), matt5_5), false);
  });

  await check("isDifferentRefLive: different scripture live → true (bypass)", () => {
    assert.strictEqual(isDifferentRefLive(liveScripture("Genesis", 4, 4), matt5_5), true);
  });

  await check("isDifferentRefLive: song lyric live → true (non-scripture, bypass)", () => {
    assert.strictEqual(isDifferentRefLive("Amazing grace how sweet the sound", matt5_5), true);
  });

  await check("isDifferentRefLive: empty / null live → true (bypass)", () => {
    assert.strictEqual(isDifferentRefLive("", matt5_5), true);
    assert.strictEqual(isDifferentRefLive(null, matt5_5), true);
  });

  await check("isDifferentRefLive: book alias 'Matt' vs 'Matthew' — canonically different (parser preserves what live says)", () => {
    // Live says "Matt 5:5 (KJV)"; target book is "Matthew". Parser lowercases
    // both — "matt" !== "matthew" so this counts as different. Belt-and-braces:
    // the shell always writes full book names into slide labels via BibleMode's
    // cardToSlide, so this asymmetry never fires in production; the guard's
    // permissive default (bypass on unclear match) is the correct behaviour.
    assert.strictEqual(isDifferentRefLive(liveScripture("Matt", 5, 5), matt5_5), true);
  });

  // ── decideBibleAutoFire — FIELD SCENARIOS ────────────────────────────────
  await check("scenario A: Matt 5:5 → wait 4s → Matt 5:5 (must fire)", () => {
    const firedMap: Record<string, number> = { [mattKey]: 1_000_000 };
    const d = decideBibleAutoFire({
      key: mattKey,
      firedMap,
      now: 1_000_000 + 4000,          // 4s later
      liveText: liveScripture("Matthew", 5, 5), // same ref still on projector
      target: matt5_5,
    });
    assert.strictEqual(d.suppress, false);
    assert.strictEqual(d.reason, "fire:stale-entry");
  });

  await check("scenario B: same-utterance duplicate detection within 500ms (must suppress)", () => {
    const firedMap: Record<string, number> = { [mattKey]: 1_000_000 };
    const d = decideBibleAutoFire({
      key: mattKey,
      firedMap,
      now: 1_000_500,                 // 500ms later, same utterance echo
      liveText: liveScripture("Matthew", 5, 5),
      target: matt5_5,
    });
    assert.strictEqual(d.suppress, true);
    assert.strictEqual(d.reason, "suppress:within-cooldown");
  });

  await check("scenario B2: duplicate detection at exactly 2.999s still suppressed", () => {
    const firedMap: Record<string, number> = { [mattKey]: 1_000_000 };
    const d = decideBibleAutoFire({
      key: mattKey,
      firedMap,
      now: 1_000_000 + 2999,
      liveText: liveScripture("Matthew", 5, 5),
      target: matt5_5,
    });
    assert.strictEqual(d.suppress, true);
  });

  await check("scenario B3: exactly at cooldown boundary (3000ms) fires", () => {
    const firedMap: Record<string, number> = { [mattKey]: 1_000_000 };
    const d = decideBibleAutoFire({
      key: mattKey,
      firedMap,
      now: 1_000_000 + 3000,
      liveText: liveScripture("Matthew", 5, 5),
      target: matt5_5,
    });
    assert.strictEqual(d.suppress, false);
    assert.strictEqual(d.reason, "fire:stale-entry");
  });

  await check("scenario C: Matt 5:5 → Gen 4:4 live → Matt 5:5 fires immediately", () => {
    // Matt fired 1s ago (well within old 5-min window), but Genesis is now
    // live — different-ref-live bypass must fire.
    const firedMap: Record<string, number> = { [mattKey]: 1_000_000 };
    const d = decideBibleAutoFire({
      key: mattKey,
      firedMap,
      now: 1_001_000,
      liveText: liveScripture("Genesis", 4, 4),
      target: matt5_5,
    });
    assert.strictEqual(d.suppress, false);
    assert.strictEqual(d.reason, "fire:different-ref-live");
  });

  await check("scenario D: Matt 5:5 → 5 other verses → back to Matt 5:5 (verse F live)", () => {
    // Simulated arrival order: matt fired, then B, C, D, E, F each fired.
    // Now (25s later) Matt is detected again while verse F (say Psalm 23:4)
    // is live. The 3s cooldown is long expired but even a stricter cooldown
    // would bypass because F ≠ Matt.
    const firedMap: Record<string, number> = {
      [mattKey]: 1_000_000,
      "b": 1_005_000,
      "c": 1_010_000,
      "d": 1_015_000,
      "e": 1_020_000,
      [psalmKey]: 1_024_000,
    };
    const d = decideBibleAutoFire({
      key: mattKey,
      firedMap,
      now: 1_025_000, // 25s after Matt
      liveText: liveScripture("Psalm", 23, 4),
      target: matt5_5,
    });
    assert.strictEqual(d.suppress, false);
    assert.strictEqual(d.reason, "fire:different-ref-live");
  });

  await check("scenario E: pathological — Matt 5:5 fired 30s ago, Matt still live (React state stale)", () => {
    // The old 5-min policy blocked this even though the preacher was clearly
    // making a fresh utterance ("as I said earlier, Matt 5:5"). Under the
    // 3s policy the entry is stale, so it fires — the whole point of the
    // change.
    const firedMap: Record<string, number> = { [mattKey]: 1_000_000 };
    const d = decideBibleAutoFire({
      key: mattKey,
      firedMap,
      now: 1_030_000, // 30s after Matt
      liveText: liveScripture("Matthew", 5, 5),
      target: matt5_5,
    });
    assert.strictEqual(d.suppress, false);
    assert.strictEqual(d.reason, "fire:stale-entry");
  });

  await check("scenario F: no prior entry — first-time fire (same-ref live variant → cooldown path)", () => {
    const d = decideBibleAutoFire({
      key: mattKey,
      firedMap: {},
      now: 1_000_000,
      liveText: liveScripture("Matthew", 5, 5),
      target: matt5_5,
    });
    assert.strictEqual(d.suppress, false);
    // With same-ref live and empty firedMap, we hit the "no-prior-entry" fast-path.
    assert.strictEqual(d.reason, "fire:no-prior-entry");
  });

  await check("scenario F2: no prior entry + non-scripture live → different-ref bypass fires first", () => {
    const d = decideBibleAutoFire({
      key: mattKey,
      firedMap: {},
      now: 1_000_000,
      liveText: null,
      target: matt5_5,
    });
    assert.strictEqual(d.suppress, false);
    // Bypass ordering: different-ref-live is checked before the map lookup.
    assert.strictEqual(d.reason, "fire:different-ref-live");
  });

  // ── Bypass ordering ──────────────────────────────────────────────────────
  await check("forceLive always fires (even inside cooldown with same-ref live)", () => {
    const firedMap: Record<string, number> = { [mattKey]: 1_000_000 };
    const d = decideBibleAutoFire({
      key: mattKey,
      firedMap,
      now: 1_000_500, // 500ms — well inside cooldown
      liveText: liveScripture("Matthew", 5, 5),
      target: matt5_5,
      forceLive: true,
    });
    assert.strictEqual(d.suppress, false);
    assert.strictEqual(d.reason, "fire:force-live-bypass");
  });

  await check("voiceCommand always fires (even inside cooldown with same-ref live)", () => {
    const firedMap: Record<string, number> = { [mattKey]: 1_000_000 };
    const d = decideBibleAutoFire({
      key: mattKey,
      firedMap,
      now: 1_000_500,
      liveText: liveScripture("Matthew", 5, 5),
      target: matt5_5,
      voiceCommand: true,
    });
    assert.strictEqual(d.suppress, false);
    assert.strictEqual(d.reason, "fire:voice-command-bypass");
  });

  await check("song lyric currently live → treated as different-ref, fires", () => {
    const firedMap: Record<string, number> = { [mattKey]: 1_000_000 };
    const d = decideBibleAutoFire({
      key: mattKey,
      firedMap,
      now: 1_000_500,
      liveText: "Amazing grace how sweet the sound",
      target: matt5_5,
    });
    assert.strictEqual(d.suppress, false);
    assert.strictEqual(d.reason, "fire:different-ref-live");
  });

  await check("image / blank / non-text live (null liveText) → fires", () => {
    const firedMap: Record<string, number> = { [mattKey]: 1_000_000 };
    const d = decideBibleAutoFire({
      key: mattKey,
      firedMap,
      now: 1_000_500,
      liveText: null,
      target: matt5_5,
    });
    assert.strictEqual(d.suppress, false);
    assert.strictEqual(d.reason, "fire:different-ref-live");
  });

  // ── Independent-key isolation ────────────────────────────────────────────
  await check("Matt fired recently doesn't suppress Gen (different keys)", () => {
    const firedMap: Record<string, number> = { [mattKey]: 1_000_000 };
    const d = decideBibleAutoFire({
      key: genKey,
      firedMap,
      now: 1_000_500,
      liveText: liveScripture("Matthew", 5, 5), // Matt still live
      target: gen4_4,
    });
    assert.strictEqual(d.suppress, false);
    // Matt currently live, target is Gen → different-ref bypass fires.
    assert.strictEqual(d.reason, "fire:different-ref-live");
  });

  // ── Regression: OLD 5-minute policy would have blocked these ─────────────
  await check("regression: sermon-long repeat (Psalm 23:4 cited 3 min later) — MUST fire", () => {
    const firedMap: Record<string, number> = { [psalmKey]: 1_000_000 };
    const d = decideBibleAutoFire({
      key: psalmKey,
      firedMap,
      now: 1_000_000 + 180_000, // 3 minutes later
      liveText: liveScripture("Psalm", 23, 4), // still on screen
      target: psalm23_4,
    });
    assert.strictEqual(d.suppress, false, "under old 5-min policy this was blocked");
    assert.strictEqual(d.reason, "fire:stale-entry");
  });

  await check("regression: 20-minute later restatement — MUST fire", () => {
    const firedMap: Record<string, number> = { [psalmKey]: 1_000_000 };
    const d = decideBibleAutoFire({
      key: psalmKey,
      firedMap,
      now: 1_000_000 + 20 * 60 * 1000,
      liveText: liveScripture("Psalm", 23, 4),
      target: psalm23_4,
    });
    assert.strictEqual(d.suppress, false);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
