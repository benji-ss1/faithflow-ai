/**
 * Spoken translation-switch detector tests (JPD Fix 6, expanded 2026-07-30).
 *
 * Run: npx tsx --env-file=.env.local test/translation-commands.test.ts
 *
 * Pure-detector tests for src/lib/translation-commands.ts:
 *   - bare abbreviations fire directly (NIV, KJV, NLT, and the expanded
 *     unambiguous set: CSB, HCSB, NRSV, ISV, GNT, DRA, WBS, BBE, NCV, CEV, RSV)
 *   - ambiguous abbreviations (WEB/AMP/MSG/ASV/NET) STILL need a switch-intent
 *     verb in the ~10 words before the match — false-positive protection
 *     ("caught in a web of sin") must survive
 *   - UNAMBIGUOUS full names fire on ANY mention (2026-07-30 policy):
 *     "King James", "New International", "Amplified"* (exception: AMBIGUOUS),
 *     "Holman", "Contemporary English", "Bible in Basic English", etc.
 *   - AMBIGUOUS full names ("the message", "amplified") still need intent
 *   - "King James" special: monarch-tail guard suppresses ("King James' day",
 *     "King James was a monarch")
 *   - Nigerian pidgin intents ("make we read am for ...")
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
  RECOGNISED_TRANSLATION_CODES,
} from "../src/lib/translation-commands";

let pass = 0;
let fail = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn())
    .then(() => { console.log(`  PASS  ${name}`); pass++; })
    .catch((e) => { console.error(`  FAIL  ${name}\n         ${(e as Error).message}`); fail++; });
}

// Full hosted-DB style list (what the shell hydrates from /api/bible/translations)
// 2026-07-30: expanded to the full 24-code recognition vocabulary + the
// legacy NCV code (kept for backwards compatibility with earlier fixtures).
const ALL = [...RECOGNISED_TRANSLATION_CODES, "NCV"];

// Helper: run the detector with a fresh cooldown and a fixed clock.
function detect(text: string, codes: string[] = ALL, now = 1_000_000) {
  resetTranslationSwitchCooldown();
  return detectTranslationSwitch(text, codes, { now });
}

async function main() {
  console.log("Translation-switch detector");

  // ── Bare abbreviations (unambiguous) ─────────────────────────────────────
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

  // ── "IV" mishearing → NIV (Deepgram drops the leading N) ─────────────────
  // The booth's natural phrasing must switch to NIV. 2026-08-15 field report:
  // "do you have IV?" / "can we get IV" / "technical IV please" were all missed.
  await check("misheard 'do you have IV?' → NIV", () => {
    const hit = detect("okay technical do you have IV?");
    assert.strictEqual(hit?.code, "NIV");
  });
  await check("misheard 'can we get IV' → NIV", () => {
    const hit = detect("can we get IV");
    assert.strictEqual(hit?.code, "NIV");
  });
  await check("misheard 'IV please' (trailing intent) → NIV", () => {
    const hit = detect("IV please");
    assert.strictEqual(hit?.code, "NIV");
  });
  await check("misheard 'do we have IV' → NIV", () => {
    const hit = detect("do we have IV");
    assert.strictEqual(hit?.code, "NIV");
  });
  // Guard: bare 'IV' with NO intent (roman numeral / medical) must NOT fire.
  await check("bare 'IV' with no intent does NOT switch (medical/roman-numeral guard)", () => {
    const hit = detect("the nurse set up an IV drip");
    // "set up an IV drip" — no switch intent verb before, no trailing intent → no fire.
    assert.strictEqual(hit, null);
  });

  await check("bare CSB (expanded set) fires", () => {
    const hit = detect("try CSB");
    assert.strictEqual(hit?.code, "CSB");
  });

  await check("bare HCSB (expanded set) fires", () => {
    const hit = detect("look at HCSB");
    assert.strictEqual(hit?.code, "HCSB");
  });

  await check("bare NRSV (expanded set) fires", () => {
    const hit = detect("we have NRSV here");
    assert.strictEqual(hit?.code, "NRSV");
  });

  await check("bare ISV (expanded set) fires", () => {
    const hit = detect("also ISV works");
    assert.strictEqual(hit?.code, "ISV");
  });

  await check("bare GNT (expanded set) fires", () => {
    const hit = detect("prefer GNT here");
    assert.strictEqual(hit?.code, "GNT");
  });

  await check("bare DRA (expanded set) fires", () => {
    const hit = detect("check DRA text");
    assert.strictEqual(hit?.code, "DRA");
  });

  await check("bare WBS (expanded set) fires", () => {
    const hit = detect("open WBS to genesis");
    assert.strictEqual(hit?.code, "WBS");
  });

  await check("bare BBE (expanded set) fires", () => {
    const hit = detect("we can see BBE says");
    assert.strictEqual(hit?.code, "BBE");
  });

  await check("bare NCV fires (backward-compat)", () => {
    const hit = detect("consider NCV");
    assert.strictEqual(hit?.code, "NCV");
  });

  await check("bare CEV fires", () => {
    const hit = detect("check CEV first");
    assert.strictEqual(hit?.code, "CEV");
  });

  await check("bare RSV fires", () => {
    const hit = detect("look at RSV");
    assert.strictEqual(hit?.code, "RSV");
  });

  await check("bare YLT fires (unambiguous — no intent needed)", () => {
    const hit = detect("consider YLT");
    assert.strictEqual(hit?.code, "YLT");
  });

  await check("bare DARBY fires (unambiguous)", () => {
    const hit = detect("try DARBY");
    assert.strictEqual(hit?.code, "DARBY");
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
    assert.strictEqual(detect("turn to AMP"), null);
  });

  await check("'read from AMP' fires (strong intent before ambiguous abbr)", () => {
    const hit = detect("read from AMP");
    assert.strictEqual(hit?.code, "AMP");
  });

  await check("'safety NET result' does NOT fire — NET is ambiguous, no intent", () => {
    assert.strictEqual(detect("that was the safety NET result"), null);
  });

  await check("'read from NET' fires (intent before NET)", () => {
    const hit = detect("read from NET");
    assert.strictEqual(hit?.code, "NET");
  });

  // ── Adversarial false-positive cases ─────────────────────────────────────
  await check("'caught in a web of sin' does NOT switch to WEB", () => {
    assert.strictEqual(detect("caught in a web of sin"), null);
  });

  await check("'go to our web page' does NOT switch to WEB", () => {
    assert.strictEqual(detect("go to our web page"), null);
  });

  await check("'back in King James' day, people were different' does NOT switch", () => {
    assert.strictEqual(detect("back in King James' day, people were different"), null);
  });

  await check("'King James was a monarch of england' does NOT switch (monarch-tail guard)", () => {
    assert.strictEqual(detect("king james was a monarch of england"), null);
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

  await check("lowercase 'the message' + intent → MSG (full-name path is case-insensitive)", () => {
    // Full names are matched against lowercase text, so lowercase MSG synonym works.
    const hit = detect("read from the message");
    assert.strictEqual(hit?.code, "MSG");
  });

  // ── Full names — unambiguous names fire on ANY mention (2026-07-30) ─────
  await check("'let's read King James' switches to KJV", () => {
    const hit = detect("let's read king james");
    assert.strictEqual(hit?.code, "KJV");
  });

  await check("'King James renders it this way' switches to KJV (no intent needed, unambiguous)", () => {
    // 2026-07-30 broadening: unambiguous full names fire on ANY mention.
    // "renders it this way" is not a monarch-tail, so it fires.
    const hit = detect("king james renders it this way");
    assert.strictEqual(hit?.code, "KJV");
  });

  await check("'the New International reads' switches to NIV (no intent)", () => {
    const hit = detect("the new international reads it beautifully");
    assert.strictEqual(hit?.code, "NIV");
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

  await check("'new revised standard' → NRSV (longer wins over 'revised standard')", () => {
    const hit = detect("open the new revised standard version");
    assert.strictEqual(hit?.code, "NRSV");
  });

  await check("'new english translation' → NET (longer wins over NET abbreviation gating)", () => {
    const hit = detect("read from the new english translation");
    assert.strictEqual(hit?.code, "NET");
  });

  await check("'the English Standard reads' → ESV (unambiguous, no intent)", () => {
    // Previously required intent — 2026-07-30 broadening allows any mention.
    const hit = detect("the english standard reads it differently");
    assert.strictEqual(hit?.code, "ESV");
  });

  await check("'Holman' fires (HCSB, expanded)", () => {
    const hit = detect("holman renders it this way");
    assert.strictEqual(hit?.code, "HCSB");
  });

  await check("'Contemporary English' fires (CEV, expanded)", () => {
    const hit = detect("contemporary english is simpler");
    assert.strictEqual(hit?.code, "CEV");
  });

  await check("'International Standard' fires (ISV, expanded)", () => {
    const hit = detect("international standard reads well");
    assert.strictEqual(hit?.code, "ISV");
  });

  await check("'Christian Standard' fires (CSB, expanded)", () => {
    const hit = detect("christian standard has this");
    assert.strictEqual(hit?.code, "CSB");
  });

  await check("'Douay-Rheims' fires (DRC)", () => {
    const hit = detect("douay-rheims uses this word");
    assert.strictEqual(hit?.code, "DRC");
  });

  await check("'Douay Rheims' (space, no hyphen) fires", () => {
    const hit = detect("douay rheims text");
    assert.strictEqual(hit?.code, "DRC");
  });

  await check("'Bible in Basic English' fires (BBE, expanded)", () => {
    const hit = detect("bible in basic english is simpler");
    assert.strictEqual(hit?.code, "BBE");
  });

  await check("'Webster's' fires (WBS, expanded)", () => {
    const hit = detect("webster's says");
    assert.strictEqual(hit?.code, "WBS");
  });

  await check("'Good News' fires (GNT, expanded)", () => {
    const hit = detect("good news paraphrases it");
    assert.strictEqual(hit?.code, "GNT");
  });

  // ── GNT gospel-phrase false-positive guard (2026-07-30) ──────────────────
  // "Good news" is one of the most common sermon phrases. The GNT_GOSPEL_TAIL_RE
  // guard mirrors KJV_MONARCH_TAIL_RE — bare "good news" followed by a
  // preposition/verb frames it as ordinary speech, not a translation switch.
  await check("'good news of the gospel' does NOT fire GNT (gospel-phrase guard)", () => {
    assert.strictEqual(detect("preach the good news of the gospel"), null);
  });

  await check("'good news that Jesus saves' does NOT fire GNT (gospel-phrase guard)", () => {
    assert.strictEqual(detect("the good news that Jesus saves the world"), null);
  });

  await check("'the good news is coming' does NOT fire GNT (gospel-phrase guard)", () => {
    assert.strictEqual(detect("the good news is coming to you"), null);
  });

  await check("'Good News Translation' bare full-name still fires (guard doesn't match 'translation')", () => {
    const hit = detect("read from the good news translation please");
    assert.strictEqual(hit?.code, "GNT");
  });

  await check("'young's literal' fires (YLT full-name)", () => {
    const hit = detect("young's literal renders it more literally");
    assert.strictEqual(hit?.code, "YLT");
  });

  await check("'Geneva Bible' fires (GEN1599)", () => {
    const hit = detect("the geneva bible says");
    assert.strictEqual(hit?.code, "GEN1599");
  });

  await check("'Darby' full-name fires", () => {
    const hit = detect("darby version has this");
    assert.strictEqual(hit?.code, "DARBY");
  });

  await check("'Revised Standard' fires (RSV) — longer 'new revised standard' still wins when present", () => {
    const hit = detect("revised standard renders it");
    assert.strictEqual(hit?.code, "RSV");
  });

  // ── AMBIGUOUS full names STILL need intent ──────────────────────────────
  await check("'the amplified sound rang out' does NOT fire (no intent, ambiguous)", () => {
    assert.strictEqual(detect("the amplified sound rang out through the sanctuary"), null);
  });

  await check("'read from the Amplified' fires (intent before ambiguous full name)", () => {
    const hit = detect("read from the amplified");
    assert.strictEqual(hit?.code, "AMP");
  });

  // ── MSG / "the message" ──────────────────────────────────────────────────
  await check("'the message of hope' does NOT trigger MSG", () => {
    assert.strictEqual(detect("let us receive the message of hope today"), null);
  });

  await check("'the message today is' does NOT fire (no intent)", () => {
    assert.strictEqual(detect("the message today is powerful"), null);
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

  await check("RECOGNISED_TRANSLATION_CODES contains all 24 codes from user's list", () => {
    for (const expected of ["KJV", "NKJV", "NIV", "ESV", "NLT", "NASB", "ASV", "WEB", "AMP", "MSG",
                            "CSB", "HCSB", "RSV", "NRSV", "CEV", "GNT", "ISV", "NET", "YLT", "DRA",
                            "WBS", "BBE", "DARBY"]) {
      assert.ok(
        (RECOGNISED_TRANSLATION_CODES as readonly string[]).includes(expected),
        `missing ${expected} from RECOGNISED_TRANSLATION_CODES`,
      );
    }
  });

  // ── "Not available" behaviour: detector returns the code even if not in DB —
  //     the UI-side "not available" toast is handled in ProOperatorShell's
  //     applyTranslationSwitch (see fallback UX added 2026-07-30). Detector
  //     only fires when the code IS available; otherwise silent.
  await check("NIV requested with only KJV+WEB available → silent (UI never sees the switch attempt)", () => {
    assert.strictEqual(detect("give me NIV", ["KJV", "WEB"]), null);
    // Rationale: the UI can't show "NIV not available" if the detector
    // never surfaces it. Trade-off documented — see BIBLE_TRANSLATIONS.md
    // for the licensed-provider fetch path (ESV.org) that expands coverage.
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

  // ── Intent-window bound (still applies to ambiguous names) ──────────────
  await check("intent must be within ~10 words before ambiguous full name (the message)", () => {
    // "read" is way too far back
    assert.strictEqual(
      detect("we read earlier and then one two three four five six seven eight nine ten eleven the message"),
      null,
    );
  });

  // ── ASR mishearings (intent + availability gated) ─────────────────────────
  await check("misheard 'do you have IV' → NIV when available + intent", () => {
    assert.deepStrictEqual(detect("do you have iv", ["NIV"]), { code: "NIV", matchedPhrase: "iv" });
  });
  await check("spelled-out 'read in N I V' → NIV", () => {
    assert.strictEqual(detect("let us read in n i v", ["NIV"])?.code, "NIV");
  });
  await check("'switch to E S V' → ESV", () => {
    assert.strictEqual(detect("switch to e s v please", ["ESV"])?.code, "ESV");
  });
  await check("misheard code with NO intent → null ('give her an IV')", () => {
    assert.strictEqual(detect("give her an iv", ["NIV"]), null);
  });
  await check("misheard code fires ONLY when the translation is available", () => {
    assert.strictEqual(detect("do you have iv", ["KJV"]), null); // NIV not in DB → no fire
  });

  // ── Misc negatives ───────────────────────────────────────────────────────
  await check("empty / plain speech returns null", () => {
    assert.strictEqual(detect(""), null);
    assert.strictEqual(detect("God is good all the time"), null);
  });

  await check("plain sermon paragraph with no translation mention returns null", () => {
    assert.strictEqual(
      detect("today I want to talk about faith hope and love the greatest of these is love"),
      null,
    );
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
