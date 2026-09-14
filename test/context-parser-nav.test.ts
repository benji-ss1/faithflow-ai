/**
 * Voice-nav parser field fixes (2026-08-31, JPD recording).
 *
 * Run: npx tsx test/context-parser-nav.test.ts
 * Uses plain node:assert (matching test/bible-antireplay.test.ts).
 *
 * Two fixes proven here:
 *  (1) terseCommandWordCount — politeness/filler stripped before the ≤5-word
 *      standalone guard, so "Continue to the next verse, please." fires while
 *      narration ("we're gonna see this in the next verse") stays blocked.
 *  (2) repairNavVerseHomophones — Deepgram's "next wrist / next 1st / next
 *      Esther" (African-accent mishearings of "verse") resolve to next_verse.
 */
import assert from "node:assert";
import {
  parseContextCommand,
  terseCommandWordCount,
  navCommandWordCount,
  repairNavVerseHomophones,
} from "../src/lib/context-parser";

const VERSE_CTX = { hasVerseContext: true, hasSlideContext: false, hasSongContext: false };
let pass = 0;
let fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n         ${(e as Error).message}`); fail++; }
}

console.log("Voice-nav parser field fixes");

// ── (1) politeness-stripped word count ──────────────────────────────────────
check("'Continue to the next verse, please.' counts as ≤5 command words", () => {
  assert.ok(terseCommandWordCount("Continue to the next verse, please.") <= 5,
    `got ${terseCommandWordCount("Continue to the next verse, please.")}`);
});
check("'Can you continue to the next verse please' counts as ≤5", () => {
  assert.ok(terseCommandWordCount("Can you continue to the next verse please") <= 5,
    `got ${terseCommandWordCount("Can you continue to the next verse please")}`);
});
check("narration 'we're gonna see this in the next verse' stays > 5 (blocked)", () => {
  assert.ok(terseCommandWordCount("we're gonna see this in the next verse") > 5,
    `got ${terseCommandWordCount("we're gonna see this in the next verse")}`);
});
check("narration 'go back to what I said earlier and think' stays > 5", () => {
  assert.ok(terseCommandWordCount("go back to what I said earlier and think") > 5);
});

// ── (2) verse-homophone repair ──────────────────────────────────────────────
check("repair 'continue to the next wrist please' → contains 'next verse'", () => {
  assert.ok(repairNavVerseHomophones("continue to the next wrist please").includes("next verse"));
});
check("repair 'continue to the next 1st' → 'next verse'", () => {
  assert.ok(repairNavVerseHomophones("continue to the next 1st").includes("next verse"));
});
check("repair 'go to the next Esther' → 'next verse'", () => {
  assert.ok(repairNavVerseHomophones("go to the next Esther").includes("next verse"));
});
check("standalone 'the book of Esther' is NOT rewritten (no 'next' anchor)", () => {
  assert.strictEqual(repairNavVerseHomophones("the book of Esther"), "the book of Esther");
});
check("'next first' is NOT rewritten (deliberately excluded — too ambiguous)", () => {
  assert.strictEqual(repairNavVerseHomophones("the next first Sunday"), "the next first Sunday");
});
check("repair 'go to the previous wrist' → 'previous verse' (symmetric)", () => {
  assert.ok(repairNavVerseHomophones("go to the previous wrist").includes("previous verse"));
});
check("parse 'go to the previous 1st please' (misheard) → prev_verse", () => {
  const c = parseContextCommand("go to the previous 1st please", VERSE_CTX);
  assert.ok(c && c.verb === "prev_verse", `verb=${c?.verb}`);
});
check("clipped 'prev wrist' repairs to 'previous verse' and resolves → prev_verse", () => {
  assert.ok(repairNavVerseHomophones("prev wrist").includes("previous verse"));
  const c = parseContextCommand("go to the prev wrist", VERSE_CTX);
  assert.ok(c && c.verb === "prev_verse", `verb=${c?.verb}`);
});

// ── (3) end-to-end: parseContextCommand fires next_verse for the field inputs ─
check("parse 'Continue to the next verse, please.' → next_verse ≥70", () => {
  const c = parseContextCommand("Continue to the next verse, please.", VERSE_CTX);
  assert.ok(c && (c.verb === "next_verse" || c.verb === "continue"), `verb=${c?.verb}`);
  assert.ok(c!.confidence >= 70, `conf=${c?.confidence}`);
});
check("parse 'continue to the next wrist please' (misheard) → next_verse", () => {
  const c = parseContextCommand("continue to the next wrist please", VERSE_CTX);
  assert.ok(c && c.verb === "next_verse", `verb=${c?.verb}`);
});
check("parse 'can we go back to verse 7 please' → goto/prev (still works)", () => {
  const c = parseContextCommand("can we go back to verse 7 please", VERSE_CTX);
  assert.ok(c, "should parse a command");
});
check("no verse context → next_verse does NOT fire", () => {
  const c = parseContextCommand("next verse please", { hasVerseContext: false, hasSlideContext: false, hasSongContext: false });
  assert.ok(!c || c.verb !== "next_verse", `verb=${c?.verb}`);
});

// ── (4) 2026-09-14: command-TAIL word count (lead-ins no longer drop commands) ─
// Mirrors the shell's full gate: relative nav, conf ≥70, count ≤5.
const REL = new Set(["next_verse", "continue", "prev_verse", "back"]);
const fires = (t: string) => {
  const c = parseContextCommand(t, VERSE_CTX);
  return !!c && REL.has(c.verb) && c.confidence >= 70 && navCommandWordCount(t, c) <= 5;
};
for (const t of [
  "Amen church can we go to next verse please",
  "Amen can we go to the next verse please",
  "John chapter 3 verse 16, can we go to next verse please",
  "John chapter 3 verse 16 can we go to next verse please",
  "John chapter 3 verse 16 next verse please",
  "are you there can we go to the next verse",
  "let us go to the next verse",
  "could we go back a verse please",
  "next verse",
]) {
  check(`FIRES: '${t}'`, () => assert.ok(fires(t)));
}
for (const t of [
  "we're gonna see this in the next verse",
  "In chapter 4, the next verse tells us God is love",
  "let us go back to the beginning",
  "Amen, let us go back to our text",
  "can I go back to my story",
  "can I tell you something next verse",
  "ushers please go back to your stations",
  "Jesus said go on and sin no more. next verse tells us",
  "Many of you have fallen away and God is saying, go back",
  "I want us to see. Continue reading",
]) {
  check(`does NOT fire: '${t}'`, () => assert.ok(!fires(t)));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
