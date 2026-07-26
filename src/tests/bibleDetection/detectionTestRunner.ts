/**
 * Bible detection test runner (plain node — no framework).
 *
 * Runs every case in testData.ts through `parseReferences()`, computes
 * per-book / per-format pass rates, and prints a detailed report.
 *
 * Run:
 *   npx tsx src/tests/bibleDetection/detectionTestRunner.ts
 *   npx tsx src/tests/bibleDetection/detectionTestRunner.ts --failures-only
 */
import { parseReferences } from "../../lib/bible-parser";
import { TEST_CASES, PSALM_46_10_GATE, type TestCase, type Expected } from "./testData";

type Failure = { input: string; expected: Expected; format: string; got: unknown; cause: string };

// Normalize a book name for comparison: strip case, collapse whitespace.
function normBook(b: string): string {
  return b.toLowerCase().replace(/\s+/g, " ").trim();
}

function checkMatch(input: string, expected: Expected): { ok: boolean; got: unknown; cause: string } {
  const refs = parseReferences(input);
  if (!refs || refs.length === 0) {
    return { ok: false, got: null, cause: "no reference parsed" };
  }
  const wantBook = normBook(expected.book);
  const match = refs.find((r) => {
    if (normBook(r.book) !== wantBook) return false;
    if (r.chapter !== expected.chapter) return false;
    if (expected.verse !== undefined) {
      // verse can appear as verseStart (single) or within a range
      if (r.verseStart === expected.verse) return true;
      if (r.verseStart <= expected.verse && r.verseEnd >= expected.verse) return true;
      return false;
    }
    return true;
  });
  if (match) return { ok: true, got: match, cause: "" };
  const first = refs[0];
  let cause = "";
  if (normBook(first.book) !== wantBook) cause = `wrong book (got ${first.book}, want ${expected.book})`;
  else if (first.chapter !== expected.chapter) cause = `wrong chapter (got ${first.chapter}, want ${expected.chapter})`;
  else if (expected.verse !== undefined && first.verseStart !== expected.verse) cause = `wrong verse (got ${first.verseStart}, want ${expected.verse})`;
  else cause = "no matching detection among parsed refs";
  return { ok: false, got: refs, cause };
}

type Stats = { total: number; passed: number };
function pct(s: Stats): number {
  return s.total === 0 ? 100 : Math.round((s.passed / s.total) * 1000) / 10;
}

export type RunReport = {
  total: number;
  passed: number;
  failed: number;
  byBook: Map<string, Stats>;
  byFormat: Map<string, Stats>;
  failures: Failure[];
  psalmGatePass: boolean;
  psalmGateFailures: string[];
};

export function runTests(cases: TestCase[] = TEST_CASES): RunReport {
  const byBook = new Map<string, Stats>();
  const byFormat = new Map<string, Stats>();
  const failures: Failure[] = [];
  let passed = 0;

  for (const c of cases) {
    const res = checkMatch(c.input, c.expected);
    const bookKey = c.expected.book;
    const bs = byBook.get(bookKey) ?? { total: 0, passed: 0 };
    bs.total++;
    const fs = byFormat.get(c.format) ?? { total: 0, passed: 0 };
    fs.total++;
    if (res.ok) {
      passed++;
      bs.passed++;
      fs.passed++;
    } else {
      failures.push({ input: c.input, expected: c.expected, format: c.format, got: res.got, cause: res.cause });
    }
    byBook.set(bookKey, bs);
    byFormat.set(c.format, fs);
  }

  const psalmGateFailures: string[] = [];
  for (const g of PSALM_46_10_GATE) {
    const r = checkMatch(g, { book: "Psalms", chapter: 46, verse: 10 });
    if (!r.ok) psalmGateFailures.push(g);
  }

  return {
    total: cases.length,
    passed,
    failed: cases.length - passed,
    byBook,
    byFormat,
    failures,
    psalmGatePass: psalmGateFailures.length === 0,
    psalmGateFailures,
  };
}

function printReport(r: RunReport, failuresOnly = false): void {
  const rate = ((r.passed / r.total) * 100).toFixed(2);
  console.log("=".repeat(70));
  console.log(`Bible Detection Test Report — ${r.total} cases, ${r.passed} passed, ${r.failed} failed  (${rate}%)`);
  console.log("=".repeat(70));

  console.log("\n== By format ==");
  const fmts = Array.from(r.byFormat.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [k, s] of fmts) {
    const p = pct(s);
    const flag = p < 95 ? " *** BELOW 95% ***" : "";
    console.log(`  ${k.padEnd(16)}  ${s.passed}/${s.total}  (${p}%)${flag}`);
  }

  console.log("\n== By book (flagging <97%) ==");
  const books = Array.from(r.byBook.entries()).sort((a, b) => pct(a[1]) - pct(b[1]));
  for (const [k, s] of books) {
    const p = pct(s);
    const flag = p < 97 ? " *** BELOW 97% ***" : "";
    if (failuresOnly && p >= 97) continue;
    console.log(`  ${k.padEnd(22)}  ${s.passed}/${s.total}  (${p}%)${flag}`);
  }

  console.log(`\n== Psalm 46:10 Gate: ${r.psalmGatePass ? "PASS" : "FAIL"} ==`);
  if (!r.psalmGatePass) {
    for (const f of r.psalmGateFailures) console.log(`  MISS: "${f}"`);
  }

  if (r.failures.length > 0) {
    console.log(`\n== Failures (${r.failures.length}) ==`);
    for (const f of r.failures) {
      const v = f.expected.verse !== undefined ? `:${f.expected.verse}` : "";
      console.log(`  [${f.format}] "${f.input}"`);
      console.log(`    want: ${f.expected.book} ${f.expected.chapter}${v}`);
      console.log(`    cause: ${f.cause}`);
      if (f.got && Array.isArray(f.got) && f.got.length > 0) {
        const g0: any = (f.got as any)[0];
        console.log(`    got:  ${g0.book} ${g0.chapter}:${g0.verseStart}${g0.verseEnd !== g0.verseStart ? "-" + g0.verseEnd : ""}  (conf ${g0.confidence})`);
      }
    }
  }
  console.log("=".repeat(70));
}

// Entry
const failuresOnly = process.argv.includes("--failures-only");
const report = runTests();
printReport(report, failuresOnly);
// Non-zero exit if any book below 97% or overall below 97%.
const anyBookBelow = Array.from(report.byBook.values()).some((s) => pct(s) < 97);
const overall = pct({ total: report.total, passed: report.passed });
if (overall < 97 || anyBookBelow || !report.psalmGatePass) {
  process.exitCode = 1;
}
