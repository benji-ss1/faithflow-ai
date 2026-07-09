/**
 * Plain-Node test for bible-parser. Run via:
 *   npx tsx src/lib/bible-parser.test.ts
 * No test framework — just assert + console.
 */
import assert from "node:assert";
import { parseReferences } from "./bible-parser";
import { spokenToNumber } from "./context-parser";

type Case = {
  name: string;
  input: string;
  expect: { book: string; chapter: number; verseStart: number; verseEnd: number };
};

const CASES: Case[] = [
  { name: "John 3:16",           input: "John 3:16",                       expect: { book: "John",    chapter: 3,  verseStart: 16, verseEnd: 16 } },
  { name: "John chapter verse",  input: "John chapter 3 verse 16",         expect: { book: "John",    chapter: 3,  verseStart: 16, verseEnd: 16 } },
  { name: "John three sixteen",  input: "John three sixteen",              expect: { book: "John",    chapter: 3,  verseStart: 16, verseEnd: 16 } },
  { name: "Romans 8 verse 28",   input: "Romans 8 verse 28",               expect: { book: "Romans",  chapter: 8,  verseStart: 28, verseEnd: 28 } },
  { name: "Psalm 91",            input: "Psalm 91",                        expect: { book: "Psalms",  chapter: 91, verseStart: 1,  verseEnd: 1  } },
  { name: "Genesis range",       input: "Genesis 1 from verse 1 to 3",     expect: { book: "Genesis", chapter: 1,  verseStart: 1,  verseEnd: 3  } },
];

let pass = 0;
let fail = 0;
for (const c of CASES) {
  const refs = parseReferences(c.input);
  const r = refs[0];
  try {
    assert.ok(r, `no reference parsed from "${c.input}"`);
    assert.strictEqual(r.book, c.expect.book, `book mismatch: got ${r.book}`);
    assert.strictEqual(r.chapter, c.expect.chapter, `chapter mismatch: got ${r.chapter}`);
    assert.strictEqual(r.verseStart, c.expect.verseStart, `verseStart mismatch: got ${r.verseStart}`);
    assert.strictEqual(r.verseEnd, c.expect.verseEnd, `verseEnd mismatch: got ${r.verseEnd}`);
    console.log(`  PASS  ${c.name}  →  ${r.book} ${r.chapter}:${r.verseStart}${r.verseStart !== r.verseEnd ? `-${r.verseEnd}` : ""}`);
    pass++;
  } catch (e) {
    console.error(`  FAIL  ${c.name}  input=${JSON.stringify(c.input)}  refs=${JSON.stringify(refs)}`);
    console.error(`        ${(e as Error).message}`);
    fail++;
  }
}

// spokenToNumber smoke tests
const NUM_CASES: [string, number | null][] = [
  ["one", 1], ["twenty", 20], ["thirty two", 32], ["five", 5],
  ["ninety nine", 99], ["7", 7], ["one hundred", 100], ["", null],
  ["banana", null], ["two hundred", 200],
];
for (const [w, expected] of NUM_CASES) {
  const got = spokenToNumber(w);
  if (got === expected) {
    console.log(`  PASS  spokenToNumber("${w}") = ${got}`);
    pass++;
  } else {
    console.error(`  FAIL  spokenToNumber("${w}") expected ${expected} got ${got}`);
    fail++;
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
