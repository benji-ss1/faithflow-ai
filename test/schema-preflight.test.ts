/**
 * The schema preflight must stay DERIVED and stay WIRED.
 * Run: npx tsx --test test/schema-preflight.test.ts
 *
 * 2026-09-22: `2026-09-21-add-stage-layouts-and-timer-parity.sql` was written,
 * reviewed, and never applied. The code that reads those tables shipped, and
 * production threw `relation "stage_layouts" does not exist` — which also took
 * the timers list down, because listTimerDefinitions does a bare db.select()
 * over the same widened table.
 *
 * A preflight existed that would have caught it. It was never committed, never
 * wired into the build, and was an ENUMERATED list of four columns that nobody
 * had extended. All three of those failures are guarded here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const check = readFileSync("scripts/check-schema.mts", "utf8");

test("the preflight runs on every build", () => {
  assert.match(pkg.scripts.prebuild, /check-schema/,
    "prebuild no longer runs the schema preflight — the database can silently fall behind the code again");
});

test("it derives tables from schema.ts rather than a hand-kept list", () => {
  // The previous version said "add a row whenever schema.ts moves ahead".
  // A guard you must remember to update fails exactly when you needed it.
  assert.match(check, /getTableConfig/, "must read real Drizzle table metadata");
  assert.match(check, /from "\.\.\/src\/lib\/db\/schema"/, "must import the actual schema");
  assert.doesNotMatch(check, /const REQUIRED\s*=\s*\[/,
    "the preflight has regressed to an enumerated list of known columns");
});

test("it checks columns, not just tables", () => {
  // The stage_layouts outage was a missing TABLE, but the same migration also
  // added five COLUMNS to an existing table, and those break db.select() just
  // as hard while the table itself looks fine.
  assert.match(check, /missingColumns/);
  assert.match(check, /information_schema\.columns/);
});

test("it fails the build rather than warning", () => {
  assert.match(check, /process\.exit\(1\)/,
    "a preflight that only warns is a preflight nobody reads");
});

test("it never blocks a build it cannot judge", () => {
  // No DATABASE_URL (local checkouts, CI without a DB) and an unreachable
  // database both exit 0. A preflight that turns a missing credential into a
  // failed deploy is a preflight that gets switched off.
  const noUrl = check.slice(check.indexOf("const url = process.env.DATABASE_URL"));
  assert.match(noUrl.slice(0, 400), /process\.exit\(0\)/);
  const connect = check.slice(check.indexOf("await client.connect()"));
  assert.match(connect.slice(0, 400), /process\.exit\(0\)/);
});
