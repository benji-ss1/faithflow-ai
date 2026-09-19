/**
 * Voice verse navigation, 2026-09-19 field report:
 *  - said "Galatians 1", then "verse 2" -> the screen went to Galatians 2:2 (bare "verse N"
 *    resolved against a stale / never-seeded chapter and ignored the verse on screen);
 *  - "go back five verses" stepped back ONE verse; natural lead-ins like "take us to the
 *    next verse" were dropped by the 5-word standalone guard.
 * Run: npx tsx test/verse-nav-commands.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseReferences, parseBareVerse } from "../src/lib/bible-parser";
import { parseContextCommand, navCommandWordCount, isPureNavCommand } from "../src/lib/context-parser";
import { liveVerseContext, pickVerseContext, seedsVerseContext } from "../src/lib/bible-verse-context";
let pass = 0, fail = 0;
const check = (n: string, fn: () => void) => { try { fn(); console.log(`  PASS  ${n}`); pass++; } catch (e) { console.error(`  FAIL  ${n}\n        ${(e as Error).message}`); fail++; } };
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const A = { hasVerseContext: true, hasSlideContext: false, hasSongContext: false };

console.log("Galatians 1 -> verse 2 (the reported bug):");
check("'Galatians 1' parses at 72 (chip-tier, below the 75 auto-fire bar) and now seeds context", () => {
  const [r] = parseReferences("Galatians chapter 1");
  assert.equal(r.book, "Galatians"); assert.equal(r.chapter, 1); assert.equal(r.confidence, 72);
  assert.equal(seedsVerseContext(r.confidence, 68, false), true, "blended ~68 still seeds");
});
check("worship mode holds scripture, so it must not seed the chapter either", () => {
  // A held detection is nav-EXEMPT once it comes back as a bare "verse N", so seeding
  // from it would let a sung lyric route a verse to the projector during worship.
  assert.equal(seedsVerseContext(92, 74, false, true), false);
  assert.equal(seedsVerseContext(92, 74, false, false), true);
});
check("fuzzy book (55) / phrase match / shaky blended never seed", () => {
  assert.equal(seedsVerseContext(55, 55, false), false);
  assert.equal(seedsVerseContext(60, 60, false), false);
  assert.equal(seedsVerseContext(95, 95, true), false);
  assert.equal(seedsVerseContext(72, 55, false), false);
});
check("seeded 'Galatians 1' + spoken 'verse 2' -> Galatians 1:2 (not chapter 2)", () => {
  const [r] = parseReferences("Galatians 1");
  const ctx = pickVerseContext({ book: r.book, chapter: r.chapter, ts: 100 }, null)!;
  const bare = parseBareVerse("verse 2")!;
  assert.deepEqual({ ...ctx, verse: bare.verse }, { book: "Galatians", chapter: 1, verse: 2 });
});
check("an EARLIER Galatians 2 context is beaten by the newer 'Galatians 1' mention", () => {
  const ctx = pickVerseContext({ book: "Galatians", chapter: 1, ts: 200 }, { book: "Galatians", chapter: 2, ts: 100 })!;
  assert.equal(ctx.chapter, 1);
});
check("a verse the operator put live AFTER the mention wins over the stale mention", () => {
  const ctx = pickVerseContext({ book: "Galatians", chapter: 2, ts: 100 }, { book: "Galatians", chapter: 1, ts: 200 })!;
  assert.equal(ctx.chapter, 1);
});
check("live verse alone is a context; nothing at all is null; tie goes to the preacher", () => {
  assert.deepEqual(pickVerseContext(null, { book: "John", chapter: 3, ts: 1 }), { book: "John", chapter: 3 });
  assert.equal(pickVerseContext(null, null), null);
  assert.equal(pickVerseContext({ book: "A", chapter: 1, ts: 5 }, { book: "B", chapter: 2, ts: 5 })!.book, "A");
});
check("liveVerseContext reads the projected reference label", () => {
  assert.deepEqual(liveVerseContext("For God so loved the world Galatians 1:2 (KJV)"), { book: "Galatians", chapter: 1 });
  assert.deepEqual(liveVerseContext("text 2 Corinthians 4:4"), { book: "2 Corinthians", chapter: 4 });
  assert.equal(liveVerseContext("Amazing grace how sweet the sound"), null);
  assert.equal(liveVerseContext(""), null);
});

console.log("relative + multi-verse commands:");
const cmd = (t: string) => parseContextCommand(t, A);
const step = (t: string) => { const c = cmd(t); return c ? { verb: c.verb, count: (c.payload as { count?: number } | undefined)?.count ?? 1 } : null; };
for (const [t, want] of [
  ["next verse", { verb: "next_verse", count: 1 }],
  ["can we go to the next verse", { verb: "next_verse", count: 1 }],
  ["go back a verse", { verb: "prev_verse", count: 1 }],
  ["go back one verse", { verb: "prev_verse", count: 1 }],
  ["go back two verses", { verb: "prev_verse", count: 2 }],
  ["go back 5 verses", { verb: "prev_verse", count: 5 }],
  ["go back five verses", { verb: "prev_verse", count: 5 }],
  ["can we go back two verses", { verb: "prev_verse", count: 2 }],
  ["back up two verses", { verb: "prev_verse", count: 2 }],
  ["go forward three verses", { verb: "next_verse", count: 3 }],
  ["skip two verses", { verb: "next_verse", count: 2 }],
  ["jump ahead 4 verses", { verb: "next_verse", count: 4 }],
] as const) check(`"${t}" -> ${want.verb} x${want.count}`, () => assert.deepEqual(step(t), want));
check("bare 'go back' is still the single-step 'back' (final path)", () => assert.equal(cmd("go back")!.verb, "back"));
check("count outside 2..20 or non-numeric falls through (no runaway jump)", () => {
  assert.notEqual(step("go back 50 verses")?.count, 50);
  assert.notEqual(step("go back many verses")?.count, "many" as never);
});
check("narration 'two verses back / before' is NOT a command", () => {
  assert.equal(cmd("it was two verses back"), null);
  assert.equal(cmd("in the two verses before that"), null);
});

console.log("standalone guard:");
for (const t of ["let's move on to the next verse", "take us to the next verse", "go on to the next verse", "show me the next verse please", "bring up the next verse", "give us the next verse"]) {
  check(`"${t}" is a pure command (not dropped by the 5-word guard)`, () => {
    assert.equal(isPureNavCommand(t), true);
    assert.ok(navCommandWordCount(t, cmd(t)) <= 5);
  });
}
for (const t of ["we're gonna see this in the next verse", "as we go to the next verse we will see", "and in the next verse he says", "this is why the next verse matters so much"]) {
  check(`narration "${t}" stays blocked`, () => {
    assert.equal(isPureNavCommand(t), false);
    const c = cmd(t);
    assert.ok(!c || navCommandWordCount(t, c) > 5, "must exceed the 5-word gate");
  });
}

console.log("wiring:");
const audio = read("src/components/operator/useAudioStream.ts");
const shell = read("src/components/operator/pro/ProOperatorShell.tsx");
check("audio hook seeds context via seedsVerseContext and picks the newest of voice/live", () => {
  assert.match(audio, /seedsVerseContext\(r\.confidence, conf, isPhrase, worshipHoldsScripture\)/);
  assert.match(audio, /pickVerseContext\(lastActiveRefRef\.current, liveContextSeenRef\.current\)/);
  assert.doesNotMatch(audio, /trustworthyForContext\) lastActiveRefRef/);
});
check("auto-fire floor is untouched (75) — seeding never fires anything", () => {
  assert.match(read("src/lib/audio-thresholds.ts"), /BIBLE_AUTOFIRE_CONFIDENCE = 75/);
});
check("shell forwards the step count on interim AND final, and the listener clamps it", () => {
  assert.equal((shell.match(/dispatchInternal\("presentflow:bible-(?:next|prev)", \{ live: true, count/g) ?? []).length, 4);
  assert.match(shell, /c >= 1 && c <= 20/);
  assert.match(shell, /advanceRef\(dir, live, count\)/);
});
check("interim fast-path leaves the bare 'go back' for the final so a count phrase isn't swallowed", () => {
  assert.match(shell, /if \(cmd\.verb === "back"\) return;/);
});
check("goto-verse anchors on the LIVE verse before the selected card", () => {
  assert.match(shell, /const anchorLabel = \(liveLabel && /);
});
check("manual Verse buttons stay preview-only single steps (no count, live=false)", () => {
  assert.match(shell, /send\(1, internalPayload<\{ live\?: boolean \}>\(ev\)\?\.live === true, stepOf\(ev\)\)/);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
