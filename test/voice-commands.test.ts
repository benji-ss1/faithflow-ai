/**
 * Voice-commands runtime matcher tests.
 * Run: npx tsx --env-file=.env.local test/voice-commands.test.ts
 *
 * Coverage:
 *   1. Empty custom list → no match.
 *   2. Exact custom phrase (case-insensitive) matches.
 *   3. Phrase inside longer irrelevant sentence: matches only when
 *      whole-word boundaries hold (won't fire when the "phrase" is a
 *      substring of an unrelated word).
 *   4. Debounce: same action within 5s does not refire; after 5s it does.
 */
import assert from "node:assert/strict";
import { matchCustomCommand, resetVoiceCommandDebounce, type CustomCommand } from "../src/lib/voice-commands";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  resetVoiceCommandDebounce();
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}`, e); }
}

// 1. Empty custom list → no match
test("empty custom list yields no match", () => {
  const r = matchCustomCommand("next verse please", []);
  assert.equal(r, null);
});

// 2. Case-insensitive exact match
test("case-insensitive match on custom phrase", () => {
  const customs: CustomCommand[] = [{ id: "1", phrase: "Go Forward", action: "next_verse" }];
  const r = matchCustomCommand("please GO forward now", customs);
  assert.ok(r, "expected match");
  assert.equal(r!.action, "next_verse");
});

// 3. Whole-word boundary — phrase must be a real word inside the sentence
test("phrase as substring of another word does NOT match (whole-word rule)", () => {
  const customs: CustomCommand[] = [{ id: "1", phrase: "go", action: "next_verse" }];
  // "gospel" contains "go" but not as a whole word → must not fire.
  const r = matchCustomCommand("we preach the gospel today", customs);
  assert.equal(r, null);
});

test("phrase as a whole word inside a longer sentence does match", () => {
  const customs: CustomCommand[] = [{ id: "1", phrase: "next verse", action: "next_verse" }];
  const r = matchCustomCommand("okay let's go to the next verse now", customs);
  assert.ok(r, "expected match on whole-word phrase");
  assert.equal(r!.action, "next_verse");
});

// 4. Debounce
test("same command within 5s does not refire; after 5s it does", () => {
  const customs: CustomCommand[] = [{ id: "1", phrase: "next verse", action: "next_verse" }];
  const t0 = 100_000;
  const first = matchCustomCommand("next verse", customs, { now: t0 });
  assert.ok(first, "first call should match");
  const second = matchCustomCommand("next verse", customs, { now: t0 + 2_000 });
  assert.equal(second, null, "within 5s window: suppressed");
  const third = matchCustomCommand("next verse", customs, { now: t0 + 6_000 });
  assert.ok(third, "past 5s window: fires again");
});

// 5. Longest phrase wins
test("longest matching phrase wins when multiple apply", () => {
  const customs: CustomCommand[] = [
    { id: "1", phrase: "next", action: "next_verse" },
    { id: "2", phrase: "next verse please", action: "kill_live" },
  ];
  const r = matchCustomCommand("okay next verse please", customs);
  assert.ok(r);
  assert.equal(r!.action, "kill_live");
});

console.log(`\n${passed} passed · ${failed} failed`);
if (failed > 0) process.exit(1);
