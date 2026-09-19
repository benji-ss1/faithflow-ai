/**
 * Holistic, clause-level voice-nav parsing (2026-09-20 owner field recording).
 *
 * The old guard counted words across the WHOLE utterance, so a clear command that
 * followed a sentence was thrown away. From the owner's own live transcript:
 *   "Go back to verse 4. Do we have verse 7, please?"  -> matched verse 4, then dropped
 *   "Do we have verse 7"                               -> matched NOTHING (no such pattern)
 *   "And that is why he came. Next verse."             -> dropped (7 words)
 * Owner: "If someone is saying next verse as the only sentence, then that's what it is …
 * a lot of times they'll say a sentence, there'll be a full stop or a comma, then they
 * say next verse."
 *
 * Rules now: split into clauses, take the LAST pure-command clause (most recent intent
 * wins), where "pure" means nothing but politeness/filler/lead-ins surrounds the command.
 * A BARE directional verb ("go back", "continue reading") must be the whole utterance —
 * field recordings caught those trailing real preaching.
 * Run: npx tsx test/nav-clauses.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { navCommandInUtterance, navClauses, isPureCommandClause, navNeedsWholeUtterance } from "../src/lib/context-parser";
let pass = 0, fail = 0;
const check = (n: string, fn: () => void) => { try { fn(); console.log(`  PASS  ${n}`); pass++; } catch (e) { console.error(`  FAIL  ${n}\n        ${(e as Error).message}`); fail++; } };
const A = { hasVerseContext: true, hasSlideContext: false, hasSongContext: false };
const hit = (t: string) => navCommandInUtterance(t, A);
const verb = (t: string) => hit(t)?.cmd.verb ?? null;
const num = (t: string) => (hit(t)?.cmd.payload as { verseNumber?: number } | undefined)?.verseNumber ?? null;

console.log("the owner's live transcript:");
check('"Go back to verse 4. Do we have verse 7, please?" ends on verse 7, not 4', () => {
  assert.equal(verb("Go back to verse 4. Do we have verse 7, please?"), "goto_bible_verse");
  assert.equal(num("Go back to verse 4. Do we have verse 7, please?"), 7);
});
check('"Do we have verse 7" is a command at all (it matched nothing before)', () => {
  assert.equal(num("Do we have verse 7"), 7);
  assert.equal(num("Do you have verse 7 please"), 7);
  assert.equal(num("have we got verse 7"), 7);
});
check("the other natural ways of asking for a numbered verse", () => {
  for (const t of ["show me verse 9", "can we see verse 3 please", "read verse 11", "turn to verse 6",
                   "pull up verse 2", "bring up verse 5", "let's look at verse 8", "take us to verse 4"]) {
    assert.ok(num(t) !== null, t);
  }
});
check("a sentence, then a full stop, then the command — the owner's core complaint", () => {
  assert.equal(verb("And that is why he came. Next verse."), "next_verse");
  assert.equal(verb("Okay. Can we go to next verse, please?"), "next_verse");
  assert.equal(verb("Amen. Go to verse 12."), "goto_bible_verse");
});
check("a comma works the same as a full stop", () => {
  assert.equal(verb("That's the whole point, next verse please"), "next_verse");
});
check("the plain forms still work on their own", () => {
  assert.equal(verb("Next verse, please."), "next_verse");
  assert.equal(verb("The next verse."), "next_verse");
  assert.equal(verb("next verse"), "next_verse");
  assert.equal(verb("previous verse"), "prev_verse");
  assert.equal(verb("go back a verse"), "prev_verse");
  assert.equal(verb("go back"), "back", "a bare verb alone is still a command");
});

console.log("narration must still be ignored (all from real recordings):");
for (const t of [
  "we're gonna see this in the next verse",
  "In chapter 4, the next verse tells us God is love",
  "In the next verse, Paul says that God is love",
  "let us go back to the beginning",
  "Amen, let us go back to our text",
  "can I go back to my story",
  "can I tell you something next verse",
  "ushers please go back to your stations",
  "Jesus said go on and sin no more. next verse tells us",
  "Many of you have fallen away and God is saying, go back",
  "I want us to see. Continue reading",
  "he skipped two verses in his reading this morning",
  "we read that in verse 7 last week",
  "this is why the next verse matters so much",
  "God is moving us forward two verses at a time",
  "Can we have NLT, please?",
]) check(`ignored: "${t}"`, () => assert.equal(hit(t), null));

console.log("the rules themselves:");
check("clauses split on sentence AND clause punctuation", () => {
  assert.deepEqual(navClauses("a. b, c? d! e; f"), ["a", "b", "c", "d", "e", "f"]);
  assert.deepEqual(navClauses("   "), []);
});
check("a clause is pure only when nothing but politeness/lead-ins surrounds the command", () => {
  assert.equal(isPureCommandClause("can we go to next verse please", "go to next verse"), true);
  assert.equal(isPureCommandClause("the next verse", "next verse"), true);
  assert.equal(isPureCommandClause("in the next verse Paul says", "next verse"), false);
  assert.equal(isPureCommandClause("anything", ""), false);
});
check("a bare directional verb must be the whole utterance; an anchored one need not be", () => {
  assert.equal(navNeedsWholeUtterance("go back"), true);
  assert.equal(navNeedsWholeUtterance("continue reading"), true);
  assert.equal(navNeedsWholeUtterance("next verse"), false);
  assert.equal(navNeedsWholeUtterance("verse 7"), false);
  assert.equal(navNeedsWholeUtterance("next one"), false);
});
check("the LAST command in an utterance wins (most recent intent)", () => {
  assert.equal(verb("Next verse. No, previous verse."), "prev_verse");
  assert.equal(num("Go to verse 3. Actually, show verse 9."), 9);
});
check("a BARE 'verse N' with no verb is still not a command (too close to scripture talk)", () => {
  // So "go to verse 3, actually verse 9" keeps verse 3 — the second half names no verb.
  assert.equal(num("go to verse 3, actually verse 9"), 3);
  assert.equal(hit("verse 9"), null);
});
check("no verse context => nothing fires at all", () => {
  assert.equal(navCommandInUtterance("next verse", { hasVerseContext: false, hasSlideContext: false, hasSongContext: false }), null);
});
check("junk input is safe", () => {
  for (const t of ["", "   ", ".", ",,,", "K."]) assert.equal(navCommandInUtterance(t, A), null, JSON.stringify(t));
});

console.log("wiring:");
const shell = readFileSync(new URL("../src/components/operator/pro/ProOperatorShell.tsx", import.meta.url), "utf8");
check("both voice paths use the clause parser, and the word-count guard is gone", () => {
  assert.equal((shell.match(/navCommandInUtterance\(/g) ?? []).length, 2);
  assert.doesNotMatch(shell, /navCommandWordCount\(/);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
