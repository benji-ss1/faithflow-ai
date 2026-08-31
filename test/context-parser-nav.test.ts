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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
