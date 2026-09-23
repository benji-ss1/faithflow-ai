// Run: npx tsx test/suites-complete.test.ts
//
// Guard: NO TEST FILE MAY BE SILENTLY SKIPPED.
//
// scripts/run-tests.mjs runs an EXPLICIT list (test/suites/ci.txt), not glob
// discovery. That is a deliberate choice — it lets known-failing files stay out
// of CI — but it has a silent failure mode: add a new test file, forget to list
// it, and it never runs. Nothing tells you. "196/196 passed" looks perfect
// while your new test has never executed once.
//
// This bit on 2026-09-21: three new test files on the timers branch were not
// running, AND seven pre-existing files were not either — including
// test/adversarial/theme-apply-capability.test.ts, a permission test. All seven
// passed when finally run; they had simply never been registered.
//
// So: every test/**/*.test.ts(x) must appear in EXACTLY ONE of
//   ci.txt            — runs on every PR, no database
//   db.txt            — runs on every PR in the "Tests (database)" job
//                       (added 2026-09-22, when CI finally got a Postgres)
//   known-failing.txt — deliberately excluded, with a reason
// A file in none of them fails THIS test, by name, with instructions.
import assert from "node:assert/strict";
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

/** Mirrors run-tests.mjs --all exactly: every .test.ts(x) under test/, minus e2e. */
const allTests = walk(join(root, "test"))
  .map((p) => relative(root, p))
  .filter((p) => /\.test\.tsx?$/.test(p) && !p.includes("e2e"))
  .sort();

/** A suite file: one path per line, `#` starts a comment (inline or whole-line). */
function readSuite(name: string): string[] {
  const p = join(root, "test/suites", name);
  assert.ok(existsSync(p), `test/suites/${name} must exist`);
  return readFileSync(p, "utf8")
    .split("\n")
    .map((l) => l.split("#")[0].trim())
    .filter(Boolean);
}

const ci = readSuite("ci.txt");
const db = readSuite("db.txt");
const knownFailing = readSuite("known-failing.txt");
const ciSet = new Set(ci);
const dbSet = new Set(db);
const knownSet = new Set(knownFailing);

assert.ok(allTests.length > 0, "found no test files at all — the walk is broken");

/* ── 1. every test file is accounted for ─────────────────────────────────── */

const unaccounted = allTests.filter((f) => !ciSet.has(f) && !dbSet.has(f) && !knownSet.has(f));
assert.deepEqual(
  unaccounted, [],
  `These test files would NEVER RUN — they are in none of test/suites/ci.txt,`
  + ` db.txt or known-failing.txt:\n`
  + unaccounted.map((f) => `  ${f}`).join("\n")
  + `\n\nAdd each to ci.txt (passes, no database), db.txt (passes, NEEDS a`
  + ` database) or known-failing.txt with a reason comment. Do not delete this`
  + ` guard instead.`,
);

/* ── 2. no ghost entries ─────────────────────────────────────────────────── */
// A renamed/deleted file left behind in a suite makes the runner fail on a
// missing path, or quietly inflate the count.

const allSet = new Set(allTests);
const ghosts = [...ciSet, ...dbSet, ...knownSet].filter((f) => !allSet.has(f));
assert.deepEqual(ghosts, [], `Listed in a suite but the file does not exist:\n${ghosts.map((f) => `  ${f}`).join("\n")}`);

/* ── 3. a file cannot be in both lists ───────────────────────────────────── */

// Every pair, not just ci-vs-known: a file in two suites runs twice, or runs
// while also being documented as excluded, and either way the lists lie.
for (const [aName, aList, bName, bSet] of [
  ["ci.txt", ci, "known-failing.txt", knownSet],
  ["db.txt", db, "known-failing.txt", knownSet],
  ["ci.txt", ci, "db.txt", dbSet],
] as const) {
  const both = aList.filter((f) => bSet.has(f));
  assert.deepEqual(both, [], `Listed in BOTH ${aName} and ${bName} (ambiguous):\n${both.map((f) => `  ${f}`).join("\n")}`);
}

/* ── 4. no duplicates within a list ──────────────────────────────────────── */

for (const [name, list] of [["ci.txt", ci], ["db.txt", db], ["known-failing.txt", knownFailing]] as const) {
  const dupes = [...new Set(list.filter((f, i) => list.indexOf(f) !== i))];
  assert.deepEqual(dupes, [], `Duplicate entries in test/suites/${name}:\n${dupes.map((f) => `  ${f}`).join("\n")}`);
}

/* ── 5. every exclusion carries a reason ─────────────────────────────────── */
// known-failing is a real escape hatch; it must never become a silent dumping
// ground. Each line needs an inline `#` note saying WHY.

const rawKnown = readFileSync(join(root, "test/suites/known-failing.txt"), "utf8")
  .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
const noReason = rawKnown.filter((l) => !l.includes("#"));
assert.deepEqual(noReason, [], `Every known-failing entry needs a reason comment (e.g. "# needs-db"):\n${noReason.map((f) => `  ${f}`).join("\n")}`);

/* ── 6. this guard itself runs in CI ─────────────────────────────────────── */

assert.ok(ciSet.has("test/suites-complete.test.ts"), "this guard must itself be listed in ci.txt, or it never runs");

console.log(`suites-complete: ${allTests.length} test files — ${ciSet.size} in CI, ${dbSet.size} in the database job, ${knownSet.size} excluded, 0 unaccounted`);
