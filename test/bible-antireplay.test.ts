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
  liveGuardText,
  parseLiveScriptureRef,
  resolvedDetectionAction,
} from "../src/lib/bible-antireplay";
import type { SlidePayload } from "../src/lib/broadcast";

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

  // ── decideBibleAutoFire — FADE-PULSE POLICY (2026-08-19) ─────────────────
  // Core rule: a verse that is ALREADY the live slide is never re-fired (it's
  // already on the projector — re-firing only replays the transition = the
  // audience-visible "fade pulse"). A DIFFERENT ref live → fire immediately
  // (swap / swap-back). voiceCommand always fires.

  await check("same ref already live, 4s later → SUPPRESS (fade-pulse fix)", () => {
    const firedMap: Record<string, number> = { [mattKey]: 1_000_000 };
    const d = decideBibleAutoFire({
      key: mattKey, firedMap, now: 1_000_000 + 4000,
      liveText: liveScripture("Matthew", 5, 5), // same ref still on projector
      target: matt5_5,
    });
    assert.strictEqual(d.suppress, true);
    assert.strictEqual(d.reason, "suppress:already-live");
  });

  await check("same-utterance duplicate 500ms, same ref live → SUPPRESS", () => {
    const firedMap: Record<string, number> = { [mattKey]: 1_000_000 };
    const d = decideBibleAutoFire({
      key: mattKey, firedMap, now: 1_000_500,
      liveText: liveScripture("Matthew", 5, 5), target: matt5_5,
    });
    assert.strictEqual(d.suppress, true);
    assert.strictEqual(d.reason, "suppress:already-live");
  });

  await check("held verse re-cited 3 min later, STILL live → SUPPRESS (no pulse)", () => {
    // The whole bug: preacher holds Psalm 11:6 up and keeps citing it. Each
    // re-detection used to re-fire and replay the fade. It must NOT.
    const firedMap: Record<string, number> = { [psalmKey]: 1_000_000 };
    const d = decideBibleAutoFire({
      key: psalmKey, firedMap, now: 1_000_000 + 180_000,
      liveText: liveScripture("Psalm", 23, 4), target: psalm23_4,
    });
    assert.strictEqual(d.suppress, true);
    assert.strictEqual(d.reason, "suppress:already-live");
  });

  await check("Matt 5:5 → Gen 4:4 live → Matt 5:5 fires immediately (fast swap-back)", () => {
    const firedMap: Record<string, number> = { [mattKey]: 1_000_000 };
    const d = decideBibleAutoFire({
      key: mattKey, firedMap, now: 1_001_000, // only 1s after Matt fired
      liveText: liveScripture("Genesis", 4, 4), target: matt5_5,
    });
    assert.strictEqual(d.suppress, false, "a genuine swap-back must fire even within seconds");
    assert.strictEqual(d.reason, "fire:different-ref-live");
  });

  await check("song lyric currently live → different-ref, fires", () => {
    const d = decideBibleAutoFire({
      key: mattKey, firedMap: { [mattKey]: 1_000_000 }, now: 1_000_500,
      liveText: "Amazing grace how sweet the sound", target: matt5_5,
    });
    assert.strictEqual(d.suppress, false);
    assert.strictEqual(d.reason, "fire:different-ref-live");
  });

  await check("image / blank / non-text live (null liveText) → fires", () => {
    const d = decideBibleAutoFire({
      key: mattKey, firedMap: {}, now: 1_000_000, liveText: null, target: matt5_5,
    });
    assert.strictEqual(d.suppress, false);
    assert.strictEqual(d.reason, "fire:different-ref-live");
  });

  await check("voiceCommand always fires (even with same-ref live)", () => {
    const d = decideBibleAutoFire({
      key: mattKey, firedMap: { [mattKey]: 1_000_000 }, now: 1_000_500,
      liveText: liveScripture("Matthew", 5, 5), target: matt5_5, voiceCommand: true,
    });
    assert.strictEqual(d.suppress, false);
    assert.strictEqual(d.reason, "fire:voice-command-bypass");
  });

  await check("forceLive no longer overrides same-ref-live → SUPPRESS", () => {
    // forceLive (occ>=2) is set for the final of a first utterance too, so it
    // must NOT force a re-fire of the on-screen verse.
    const d = decideBibleAutoFire({
      key: mattKey, firedMap: { [mattKey]: 1_000_000 }, now: 1_004_000,
      liveText: liveScripture("Matthew", 5, 5), target: matt5_5, forceLive: true,
    });
    assert.strictEqual(d.suppress, true);
    assert.strictEqual(d.reason, "suppress:already-live");
  });

  await check("forceLive with DIFFERENT ref live → fires (swap-back)", () => {
    const d = decideBibleAutoFire({
      key: mattKey, firedMap: { [mattKey]: 1_000_000 }, now: 1_000_500,
      liveText: liveScripture("Genesis", 4, 4), target: matt5_5, forceLive: true,
    });
    assert.strictEqual(d.suppress, false);
    assert.strictEqual(d.reason, "fire:different-ref-live");
  });

  await check("independent keys: Matt live, target Gen → fires (different ref)", () => {
    const d = decideBibleAutoFire({
      key: genKey, firedMap: { [mattKey]: 1_000_000 }, now: 1_000_500,
      liveText: liveScripture("Matthew", 5, 5), target: gen4_4,
    });
    assert.strictEqual(d.suppress, false);
    assert.strictEqual(d.reason, "fire:different-ref-live");
  });

  // ── resolvedDetectionAction: re-hearing the live verse is a COMPLETE no-op ──
  // (2026-08-30 verse-repeat deeper fix — live output AND preview must both hold)
  const johnLive: SlidePayload = { kind: "text", text: "16 For God so loved the world", reference: "John 3:16 (KJV)" };
  const johnRef = { book: "John", chapter: 3, verseStart: 16, verseEnd: 16 };

  await check("liveGuardText: returns the reference label", () => {
    assert.strictEqual(liveGuardText(johnLive), "John 3:16 (KJV)");
  });
  await check("liveGuardText: non-text slide → null", () => {
    assert.strictEqual(liveGuardText({ kind: "image", url: "x" }), null);
    assert.strictEqual(liveGuardText(null), null);
  });
  await check("resolvedDetectionAction: SAME verse already live → no send, no preview churn", () => {
    const a = resolvedDetectionAction(johnLive, johnRef);
    assert.strictEqual(a.send, false);
    assert.strictEqual(a.syncPreview, false);
  });
  await check("resolvedDetectionAction: same ref, DIFFERENT body text (formatting/translation) → still no re-send/churn", () => {
    const differentBody: SlidePayload = { kind: "text", text: "For God so loved the world (v16)", reference: "John 3:16 (NIV)" };
    const a = resolvedDetectionAction(differentBody, johnRef);
    assert.strictEqual(a.send, false, "same reference → no projector re-pulse even if body differs");
    assert.strictEqual(a.syncPreview, false);
  });
  await check("resolvedDetectionAction: NEXT verse (different ref) → send + sync", () => {
    const a = resolvedDetectionAction(johnLive, { book: "John", chapter: 3, verseStart: 17, verseEnd: 17 });
    assert.strictEqual(a.send, true);
    assert.strictEqual(a.syncPreview, true);
  });
  await check("resolvedDetectionAction: swap-back to a DIFFERENT passage → send + sync", () => {
    const a = resolvedDetectionAction(johnLive, { book: "Genesis", chapter: 1, verseStart: 1, verseEnd: 1 });
    assert.strictEqual(a.send, true);
    assert.strictEqual(a.syncPreview, true);
  });
  await check("resolvedDetectionAction: non-scripture live (song/image) → treated as different → send + sync", () => {
    const a = resolvedDetectionAction({ kind: "image", url: "x" }, johnRef);
    assert.strictEqual(a.send, true);
    assert.strictEqual(a.syncPreview, true);
  });
  await check("resolvedDetectionAction: reference display OFF (no label) → safe default fires", () => {
    const noRef: SlidePayload = { kind: "text", text: "16 For God so loved the world" };
    const a = resolvedDetectionAction(noRef, johnRef);
    assert.strictEqual(a.send, true, "unlabelled slide isn't ref-identifiable → allow (safe default)");
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
