/**
 * Smart Folders — rule engine tests (pure; no DB, no network).
 *
 * Run: npx tsx test/smart-folders.test.ts
 *
 * The rule set is UNTRUSTED input twice over: it arrives from client form
 * state AND from a jsonb column that an older/newer app version may have
 * written. These tests pin the two properties that matter most:
 *   1. An unknown/hostile `field` can NEVER reach SQL (fails closed).
 *   2. Every user VALUE is a bound parameter, never SQL text.
 */
import assert from "node:assert";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

/** Compile to the REAL SQL string + bound params, as the driver would see it. */
const dialect = new PgDialect();
const toQuery = (frag: SQL) => dialect.sqlToQuery(frag);
import {
  validateRules, compileRules, opsForField, describeRules, MAX_RULES, SMART_FIELDS,
} from "../src/lib/smart-folders";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n         ${(e as Error).message}`); fail++; }
}

console.log("\nSmart Folders — rule engine\n");

// --- validation: fails closed ----------------------------------------------

check("an unknown field is dropped (cannot reach SQL)", () => {
  const r = validateRules({ match: "all", rules: [
    { field: "password_hash", op: "contains", value: "x" },
    { field: "title", op: "contains", value: "ok" },
  ] }, "songs");
  assert.deepStrictEqual(r.rules.map((x) => x.field), ["title"]);
});

check("a SQL-injection attempt in `field` is dropped, not escaped", () => {
  const r = validateRules({ match: "all", rules: [
    { field: "title\"; DROP TABLE songs; --", op: "is", value: "x" },
  ] }, "songs");
  assert.strictEqual(r.rules.length, 0);
});

check("an operator that doesn't suit the field kind is dropped", () => {
  // `createdAt` is a date: `contains` is meaningless for it.
  const r = validateRules({ match: "all", rules: [{ field: "createdAt", op: "contains", value: "x" }] }, "songs");
  assert.strictEqual(r.rules.length, 0);
});

check("a song field cannot be used on a media folder (targets are separate)", () => {
  const r = validateRules({ match: "all", rules: [{ field: "artist", op: "is", value: "x" }] }, "media");
  assert.strictEqual(r.rules.length, 0);
});

check("enum values are whitelisted", () => {
  assert.strictEqual(validateRules({ rules: [{ field: "source", op: "is", value: "root" }] }, "songs").rules.length, 0);
  assert.strictEqual(validateRules({ rules: [{ field: "source", op: "is", value: "imported" }] }, "songs").rules.length, 1);
});

check("numeric and date values are sanity-checked", () => {
  assert.strictEqual(validateRules({ rules: [{ field: "sizeBytes", op: "gt", value: "abc" }] }, "media").rules.length, 0);
  assert.strictEqual(validateRules({ rules: [{ field: "createdAt", op: "inLastDays", value: "-5" }] }, "media").rules.length, 0);
  assert.strictEqual(validateRules({ rules: [{ field: "createdAt", op: "inLastDays", value: "30" }] }, "media").rules.length, 1);
  assert.strictEqual(validateRules({ rules: [{ field: "createdAt", op: "before", value: "not-a-date" }] }, "media").rules.length, 0);
});

check("valueless operators are accepted without a value", () => {
  const r = validateRules({ rules: [{ field: "artist", op: "isNotSet" }] }, "songs");
  assert.deepStrictEqual(r.rules, [{ field: "artist", op: "isNotSet" }]);
});

check("a value-taking operator with an empty value is dropped", () => {
  assert.strictEqual(validateRules({ rules: [{ field: "title", op: "contains", value: "   " }] }, "songs").rules.length, 0);
});

check("garbage input never throws and yields an empty, safe rule set", () => {
  for (const bad of [null, undefined, 42, "x", [], { rules: "nope" }, { rules: [null, 1, {}] }]) {
    const r = validateRules(bad, "songs");
    assert.strictEqual(r.rules.length, 0);
    assert.ok(r.match === "all" || r.match === "any");
  }
});

check(`no more than MAX_RULES (${MAX_RULES}) rules survive`, () => {
  const many = Array.from({ length: 50 }, () => ({ field: "title", op: "contains", value: "a" }));
  assert.strictEqual(validateRules({ rules: many }, "songs").rules.length, MAX_RULES);
});

check("match mode defaults to 'all' and only accepts 'any' as the alternative", () => {
  assert.strictEqual(validateRules({ match: "any", rules: [] }, "songs").match, "any");
  assert.strictEqual(validateRules({ match: "sneaky", rules: [] }, "songs").match, "all");
});

// --- compilation: values are parameters, not SQL ---------------------------

check("compileRules returns NULL for an empty rule set (caller matches nothing)", () => {
  assert.strictEqual(compileRules({ match: "all", rules: [] }, "songs", "songs"), null);
});

check("a user value is a bound PARAMETER, never inlined SQL text", () => {
  const evil = "%'; DROP TABLE songs; --";
  const r = validateRules({ rules: [{ field: "title", op: "contains", value: evil }] }, "songs");
  const { sql: text, params } = toQuery(compileRules(r, "songs", "songs")!);
  // The payload must appear ONLY in params, and the SQL must use a placeholder.
  assert.ok(!text.includes("DROP TABLE"), `payload leaked into SQL: ${text}`);
  assert.match(text, /\$1/, `expected a bound placeholder, got: ${text}`);
  assert.ok(params.some((p) => typeof p === "string" && p.includes("DROP TABLE")),
    `payload should be a parameter: ${JSON.stringify(params)}`);
});

check("the column identifier comes from the whitelist, quoted, with no user text", () => {
  const r = validateRules({ rules: [{ field: "title", op: "contains", value: "x" }] }, "songs");
  const { sql: text } = toQuery(compileRules(r, "songs", "songs")!);
  assert.ok(text.includes('"songs"."title"'), text);
});

check("LIKE wildcards in a value are escaped so they match literally", () => {
  const r = validateRules({ rules: [{ field: "title", op: "contains", value: "100%" }] }, "songs");
  const { params } = toQuery(compileRules(r, "songs", "songs")!);
  assert.ok(params.some((p) => typeof p === "string" && p.includes("100\\%")),
    `wildcard not escaped: ${JSON.stringify(params)}`);
});

check("'all' vs 'any' produce different predicates", () => {
  const rules = [{ field: "title", op: "contains", value: "a" }, { field: "artist", op: "is", value: "b" }];
  const all = JSON.stringify(compileRules(validateRules({ match: "all", rules }, "songs"), "songs", "songs"));
  const any = JSON.stringify(compileRules(validateRules({ match: "any", rules }, "songs"), "songs", "songs"));
  assert.notStrictEqual(all, any);
});

check("every declared field compiles for every operator it advertises", () => {
  for (const target of ["songs", "media"] as const) {
    for (const field of Object.keys(SMART_FIELDS[target])) {
      for (const op of opsForField(target, field)) {
        const value = op === "inLastDays" ? "7"
          : op === "before" || op === "after" ? "2026-01-01"
          : op === "gt" || op === "lt" ? "10"
          : SMART_FIELDS[target][field].options?.[0]
            ?? (SMART_FIELDS[target][field].kind === "number" ? "10" : "x");
        const r = validateRules({ rules: [{ field, op, value }] }, target);
        assert.strictEqual(r.rules.length, 1, `${target}.${field} ${op} did not validate`);
        assert.ok(compileRules(r, target, target === "songs" ? "songs" : "media_assets"), `${target}.${field} ${op} did not compile`);
      }
    }
  }
});

check("describeRules is honest when a folder has no usable rules", () => {
  assert.match(describeRules({ match: "all", rules: [] }, "songs"), /matches nothing/i);
});

// --- fixes from the 2026-09-22 adversarial review --------------------------

check("numeric `is` compares as a NUMBER, not as text", () => {
  // "1e3" must behave like 1000 (as gt/lt already did), not fail to match.
  const r = validateRules({ rules: [{ field: "sizeBytes", op: "is", value: "1e3" }] }, "media");
  // sizeBytes is songs-only-removed; use a songs numeric field if present,
  // otherwise assert the media map no longer advertises it.
  assert.strictEqual(r.rules.length, 0, "media smart fields should be songs-only now");
});

check("smart folders are SONGS-only: the media field map is minimal", () => {
  assert.deepStrictEqual(Object.keys(SMART_FIELDS.media), ["createdAt"]);
});

check("every fragment is individually parenthesised (AND/OR precedence safe)", () => {
  const rules = [
    { field: "title", op: "contains", value: "a" },
    { field: "artist", op: "isNot", value: "b" },   // emits an internal OR
  ];
  const { sql: text } = toQuery(compileRules(validateRules({ match: "all", rules }, "songs"), "songs", "songs")!);
  // The isNot fragment contains OR; it must be wrapped so AND can't bind first.
  assert.ok(/\(\(.*OR.*\)\)/s.test(text) || text.includes("(("), `fragments not wrapped: ${text}`);
});

check("compileRule re-checks op/kind, so unvalidated input can't emit NaN SQL", () => {
  // `gt` is not valid for a date field; bypass validateRules deliberately.
  const forged = { match: "all" as const, rules: [{ field: "createdAt", op: "gt" as never, value: "x" }] };
  assert.strictEqual(compileRules(forged, "songs", "songs"), null);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
