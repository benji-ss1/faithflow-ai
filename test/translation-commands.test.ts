/**
 * Spoken translation-switch detector tests (JPD Fix 6).
 *
 * Run: npx tsx --env-file=.env.local test/translation-commands.test.ts
 *
 * Pure-detector tests for src/lib/translation-commands.ts:
 *   - bare abbreviations fire directly (NIV, KJV, NLT)
 *   - ambiguous abbreviations (WEB/AMP/MSG/ASV) + full names need a
 *     switch-intent verb in the ~10 words before the match
 *   - Nigerian pidgin intents ("make we read am for ...")
 *   - negatives: "the message of hope", "King James was a monarch"
 *   - DB-availability gating (only available codes fire)
 *   - 10s cooldown + reset
 *
 * Uses plain node:assert (matching test/projector-output.test.ts).
 */
import assert from "node:assert";
import {
  detectTranslationSwitch,
  resetTranslationSwitchCooldown,
  setAvailableTranslationCodes,
  getAvailableTranslationCodes,
  SEEDED_TRANSLATION_CODES,
} from "../src/lib/translation-commands";

let pass = 0;
let fail = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn())
    .then(() => { console.log(`  PASS  ${name}`); pass++; })
    .catch((e) => { console.error(`  FAIL  ${name}\n         ${(e as Error).message}`); fail++; });
}

// Full hosted-DB style list (what the shell hydrates from /api/bible/translations)
const ALL = ["KJV", "NKJV", "NIV", "NLT", "ESV", "AMP", "MSG", "NASB", "WEB", "ASV", "YLT", "DRC", "DARBY", "GEN1599"];

// Helper: run the detector with a fresh cooldown and a fixed clock.
function detect(text: string, codes: string[] = ALL, now = 1_000_000) {
  resetTranslationSwitchCooldown();
  return detectTranslationSwitch(text, codes, { now });
}

async function main() {
  console.log("Translation-switch detector");

  // ── Bare abbreviations ───────────────────────────────────────────────────
  await check("bare abbreviation NIV fires without intent context", () => {
    const hit = detect("give me NIV");
    assert.strictEqual(hit?.code, "NIV");
  });

  await check("bare abbreviation KJV fires mid-sentence", () => {
    const hit = detect("that verse again KJV please");
    assert.strictEqual(hit?.code, "KJV");
  });

  await check("read that in NLT", () => {
    const hit = detect("read that in NLT");
    assert.strictEqual(hit?.code, "NLT");
  });

  await check("lowercase abbreviation still matches (ASR casing)", () => {
    const hit = detect("let's see it in nkjv");
    assert.strictEqual(hit?.code, "NKJV");
  });

  // ── Ambiguous abbreviations need intent ──────────────────────────────────
  await check("bare 'web' (ordinary word) does NOT fire without intent", () => {
    // "web" alone with no switch verb anywhere before it
    assert.strictEqual(detect("caught web deceit"), null);
  });

  await check("'switch to WEB' fires (intent before ambiguous abbr)", () => {
    const hit = detect("switch to WEB");
    assert.strictEqual(hit?.code, "WEB");
  });

  await check("'turn to AMP' does NOT fire — 'turn' dropped from strong-intent list", () => {
    // Intentional change (Phase 3 review): weak intents (turn/go/in/for/...)
    // caused false positives, so 'turn' no longer counts as switch intent.
    assert.strictEqual(detect("turn to AMP"), null);
  });

  await check("'read from AMP' fires (strong intent before ambiguous abbr)", () => {
    const hit = detect("read from AMP");
    assert.strictEqual(hit?.code, "AMP");
  });

  // ── Adversarial false-positive cases (Phase 3 review) ────────────────────
  await check("'caught in a web of sin' does NOT switch to WEB", () => {
    assert.strictEqual(detect("caught in a web of sin"), null);
  });

  await check("'go to our web page' does NOT switch to WEB", () => {
    assert.strictEqual(detect("go to our web page"), null);
  });

  await check("'back in King James' day, people were different' does NOT switch", () => {
    assert.strictEqual(detect("back in King James' day, people were different"), null);
  });

  await check("'switch to the WEB version' (capitalized acronym) → WEB", () => {
    const hit = detect("switch to the WEB version");
    assert.strictEqual(hit?.code, "WEB");
  });

  await check("'let's read the King James Version' → KJV", () => {
    const hit = detect("let's read the King James Version");
    assert.strictEqual(hit?.code, "KJV");
  });

  await check("lowercase 'read from amp' does NOT fire (ambiguous abbrs are case-sensitive)", () => {
    assert.strictEqual(detect("read from amp"), null);
  });

  // ── Full names — intent-gated ────────────────────────────────────────────
  await check("'let's read King James' switches to KJV", () => {
    const hit = detect("let's read king james");
    assert.strictEqual(hit?.code, "KJV");
  });

  await check("'King James was a monarch' does NOT switch", () => {
    assert.strictEqual(detect("king james was a monarch of england"), null);
  });

  await check("'switch to the New Living Translation' → NLT", () => {
    const hit = detect("can we switch to the new living translation");
    assert.strictEqual(hit?.code, "NLT");
  });

  await check("'new king james' wins over 'king james' (longest-first)", () => {
    const hit = detect("read it in the new king james version");
    assert.strictEqual(hit?.code, "NKJV");
  });

  await check("'new american standard' → NASB, not ASV", () => {
    const hit = detect("open the new american standard bible");
    assert.strictEqual(hit?.code, "NASB");
  });

  await check("full name without intent does NOT fire", () => {
    assert.strictEqual(detect("the english standard version people did a study"), null);
  });

  await check("intent must be within ~10 words before the name", () => {
    // "read" is 14 words before "king james" — outside the window
    assert.strictEqual(
      detect("we read earlier and then one two three four five six seven eight nine ten eleven king james"),
      null,
    );
  });

  // ── MSG / "the message" ──────────────────────────────────────────────────
  await check("'the message of hope' does NOT trigger MSG", () => {
    assert.strictEqual(detect("let us receive the message of hope today"), null);
  });

  await check("'read it from The Message' triggers MSG", () => {
    const hit = detect("read it from the message");
    assert.strictEqual(hit?.code, "MSG");
  });

  // ── Pidgin ───────────────────────────────────────────────────────────────
  await check("pidgin: 'make we read am for NLT'", () => {
    const hit = detect("make we read am for NLT");
    assert.strictEqual(hit?.code, "NLT");
  });

  await check("pidgin: 'make we read am for king james'", () => {
    const hit = detect("abeg make we read am for king james");
    assert.strictEqual(hit?.code, "KJV");
  });

  // ── Availability gating ──────────────────────────────────────────────────
  await check("code not in available list does NOT fire", () => {
    assert.strictEqual(detect("give me NIV", ["KJV", "WEB"]), null);
  });

  await check("empty available list never fires", () => {
    assert.strictEqual(detect("give me KJV", []), null);
  });

  await check("shared store hydration + fallback", () => {
    assert.deepStrictEqual(getAvailableTranslationCodes(), SEEDED_TRANSLATION_CODES);
    setAvailableTranslationCodes(["niv", " kjv ", ""]);
    assert.deepStrictEqual(getAvailableTranslationCodes(), ["NIV", "KJV"]);
    setAvailableTranslationCodes([]); // empty payload keeps previous list
    assert.deepStrictEqual(getAvailableTranslationCodes(), ["NIV", "KJV"]);
  });

  await check("default-arg path uses the shared store", () => {
    setAvailableTranslationCodes(["NLT"]);
    resetTranslationSwitchCooldown();
    const hit = detectTranslationSwitch("read that in NLT", undefined, { now: 1_000_000 });
    assert.strictEqual(hit?.code, "NLT");
    resetTranslationSwitchCooldown();
    assert.strictEqual(detectTranslationSwitch("give me KJV", undefined, { now: 1_000_000 }), null);
  });

  // ── Cooldown ─────────────────────────────────────────────────────────────
  await check("10s cooldown blocks an immediate repeat", () => {
    resetTranslationSwitchCooldown();
    const first = detectTranslationSwitch("give me NIV", ALL, { now: 100_000 });
    assert.strictEqual(first?.code, "NIV");
    const second = detectTranslationSwitch("give me KJV", ALL, { now: 105_000 });
    assert.strictEqual(second, null, "5s later should still be in cooldown");
  });

  await check("cooldown expires after 10s", () => {
    resetTranslationSwitchCooldown();
    assert.strictEqual(detectTranslationSwitch("give me NIV", ALL, { now: 100_000 })?.code, "NIV");
    const later = detectTranslationSwitch("give me KJV", ALL, { now: 110_001 });
    assert.strictEqual(later?.code, "KJV");
  });

  await check("resetTranslationSwitchCooldown clears the cooldown", () => {
    resetTranslationSwitchCooldown();
    assert.strictEqual(detectTranslationSwitch("give me NIV", ALL, { now: 100_000 })?.code, "NIV");
    resetTranslationSwitchCooldown();
    assert.strictEqual(detectTranslationSwitch("give me KJV", ALL, { now: 100_500 })?.code, "KJV");
  });

  await check("non-firing text does NOT consume the cooldown", () => {
    resetTranslationSwitchCooldown();
    assert.strictEqual(detectTranslationSwitch("king james was a monarch", ALL, { now: 100_000 }), null);
    assert.strictEqual(detectTranslationSwitch("give me NIV", ALL, { now: 100_100 })?.code, "NIV");
  });

  // ── Misc negatives ───────────────────────────────────────────────────────
  await check("empty / plain speech returns null", () => {
    assert.strictEqual(detect(""), null);
    assert.strictEqual(detect("God is good all the time"), null);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
