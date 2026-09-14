// Run: npx tsx test/changelog-generator.test.ts
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, readdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  parseChangeFile, readHistory, buildEntries, renderModule, bumpPatch, historyWarnings, nextChangeVersion, isCalendarDate,
} from "../scripts/changelog-lib.mjs";
import { mergeChangelog, type ChangelogEntry } from "../src/lib/changelog-types";
import { CHANGELOG } from "../src/lib/changelog";
import { GENERATED_CHANGELOG } from "../src/lib/changelog.generated";
import { newerEntries, forwardLastSeen, cmpVersion } from "../src/lib/whats-new";

const md = (fm: string) => `---\n${fm}\n---\n`;
const VD = "version: 0.1.500\ndate: 2026-09-14";

// ---- parse
const a = parseChangeFile(md(`headline: Alpha thing\naudience: admin\norder: 2\n${VD}\nhighlights:\n  - one: with colon\n  - "two"`), "alpha");
assert.equal(a.headline, "Alpha thing");
assert.equal(a.audience, "admin");
assert.deepEqual(a.highlights, ["one: with colon", "two"]);
assert.deepEqual(parseChangeFile(md(`headline: Solo\n${VD}`), "solo").highlights, ["Solo"], "highlights default to headline");
assert.equal(parseChangeFile("---\r\nheadline: Hi\r\nversion: 0.1.1\r\ndate: 2026-01-01\r\nhighlights:\r\n  - a\r\n---\r\n", "crlf").highlights[0], "a", "CRLF ok");
assert.throws(() => parseChangeFile(md(`audience: operator\n${VD}`), "x"), /headline is required/);
assert.throws(() => parseChangeFile(md(`headline: h\naudience: everyone\n${VD}`), "x"), /audience/);
assert.throws(() => parseChangeFile(md("headline: h\nversion: v1\ndate: 2026-09-14"), "x"), /version must/);
assert.throws(() => parseChangeFile("no frontmatter", "x"), /frontmatter/);
assert.throws(() => parseChangeFile(md(`headline: h\n${VD}\nbogus: 1`), "x"), /unknown key/);
// required version/date, duplicate keys, calendar dates
assert.throws(() => parseChangeFile(md("headline: h\ndate: 2026-09-14"), "x"), /version is required/);
assert.throws(() => parseChangeFile(md("headline: h\nversion: 0.1.1"), "x"), /date is required/);
assert.throws(() => parseChangeFile(md(`headline: a\nheadline: b\n${VD}`), "x"), /duplicate key "headline"/);
assert.throws(() => parseChangeFile(md("headline: h\nversion: 0.1.1\ndate: 2026-13-45"), "x"), /real YYYY-MM-DD/);
assert.throws(() => parseChangeFile(md("headline: h\nversion: 0.1.1\ndate: 2026-02-30"), "x"), /real YYYY-MM-DD/);
assert.ok(isCalendarDate("2028-02-29") && !isCalendarDate("2026-02-29"));

// ---- build: grouping, ordering, dedupe rules
const history = [{ version: "0.1.402", headline: "Old" }, { version: "0.1.401", headline: "Older" }];
const opts = { history };
const b = parseChangeFile(md("headline: Beta\norder: 1\nversion: 0.1.404\ndate: 2026-09-01"), "beta");
const a404 = { ...a, version: "0.1.404", date: "2026-09-03" };
const pinned = parseChangeFile(md("headline: Pinned\nversion: 0.1.403\ndate: 2026-09-02"), "pinned");
const merged = parseChangeFile(md("headline: Old\nversion: 0.1.402\ndate: 2026-09-14"), "already-merged");
const entries = buildEntries([a404, b, pinned, merged], opts);
assert.deepEqual(entries.map((e: ChangelogEntry) => e.version), ["0.1.404", "0.1.403"], "grouped by explicit version, newest-first");
assert.equal(entries[0].headline, "Beta", "order:1 leads the group");
assert.deepEqual(entries[0].highlights, ["Beta", "one: with colon", "two"]);
assert.equal(entries[0].date, "2026-09-03", "entry date = latest file date");
assert.ok(!JSON.stringify(entries).includes('"Old"'), "same version + same headline as history is skipped");
assert.throws(() => buildEntries([parseChangeFile(md("headline: New\nversion: 0.1.402\ndate: 2026-09-14"), "c")], opts), /already exists/);
assert.throws(() => buildEntries([parseChangeFile(md("headline: Old\nversion: 0.1.410\ndate: 2026-09-14"), "c")], opts), /headline already used by version 0\.1\.402/);
assert.deepEqual(buildEntries([], opts), []);
// warning (local build) for a version below newest history
assert.equal(historyWarnings([parseChangeFile(md("headline: Low\nversion: 0.1.300\ndate: 2026-09-14"), "low")], history).length, 1);
assert.equal(historyWarnings([b], history).length, 0);
// determinism: no clock input, order-independent
assert.equal(renderModule(entries), renderModule(buildEntries([merged, pinned, b, a404], opts)));
assert.equal(bumpPatch("0.1.9"), "0.1.10");
assert.equal(nextChangeVersion(history, ["0.1.404", "0.1.403"]), "0.1.405");
assert.equal(nextChangeVersion(history, []), "0.1.403");

// ---- merge: dedupe by version (history wins) + newest-first
const H: ChangelogEntry[] = [{ version: "0.1.402", date: "", headline: "hist", highlights: [] }];
const G: ChangelogEntry[] = [
  { version: "0.1.402", date: "", headline: "gen-dup", highlights: [] },
  { version: "0.1.410", date: "", headline: "gen", highlights: [] },
];
assert.deepEqual(mergeChangelog(G, H).map((e) => e.headline), ["gen", "hist"]);

// ---- readHistory: field-order independent, finds every curated entry
const src = readFileSync("src/lib/changelog.ts", "utf8");
const realHistory = readHistory(src);
const histBlock = src.slice(src.indexOf("CHANGELOG_HISTORY"), src.indexOf("export const CHANGELOG:"));
const declared = (histBlock.match(/^ {4}version:\s*"/gm) || []).length;
assert.equal(realHistory.length, declared, "every curated entry parsed");
assert.ok(realHistory.length >= 383, `found ${realHistory.length}`);
for (const v of ["0.1.243", "0.1.227", "0.1.219", "0.1.210"]) {
  assert.ok(realHistory.some((h: { version: string; headline: string }) => h.version === v && h.headline), `headline-after-highlights entry ${v}`);
}
const reordered = readHistory(`const CHANGELOG_HISTORY: ChangelogEntry[] = [
  { highlights: [{ text: "x", headline: "nested-no" }, "a } { \\" ]"], headline: 'Single \\'q\\'', date: "d", version: "1.0.1" }, // { version: "9.9.9"
  /* { version: "8.8.8", headline: "c" } */ { version: "1.0.0", headline: "B\\u00e9" },
];`);
assert.deepEqual(reordered, [{ version: "1.0.1", headline: "Single 'q'" }, { version: "1.0.0", headline: "Bé" }]);

// ---- real data: shape valid, newest-first, unique versions, generated entries present
for (const e of CHANGELOG) {
  assert.ok(e.version && e.date && e.headline && Array.isArray(e.highlights) && e.highlights.length, `valid ${e.version}`);
}
for (let i = 1; i < CHANGELOG.length; i++) assert.ok(cmpVersion(CHANGELOG[i - 1].version, CHANGELOG[i].version) > 0, `ordered at ${i}`);
for (const g of GENERATED_CHANGELOG) assert.ok(CHANGELOG.includes(g), `generated ${g.version} merged`);
const all = JSON.stringify(CHANGELOG);
assert.ok(all.includes("A full editor for your OBS live-stream words"));
assert.ok(all.includes("Over your camera now has a Layout choice"));
assert.deepEqual(GENERATED_CHANGELOG.map((e) => e.version), ["0.1.404", "0.1.403"]);

// ---- WhatsNew: a new generated entry shows exactly once
let stored: string | null = "0.1.402";
const shows = (cl: ChangelogEntry[]) => {
  const n = newerEntries(cl, stored);
  if (!n.length) return 0;
  stored = forwardLastSeen(stored, n[0].version);
  return n.length;
};
assert.ok(shows(CHANGELOG) > 0);
assert.equal(stored, CHANGELOG[0].version);
assert.equal(shows(CHANGELOG), 0);

// ---- LIFECYCLE: day1 release dismissed -> day2 note via `changes:new` -> modal shows it once
const tmp = mkdtempSync(join(tmpdir(), "pf-changes-"));
mkdirSync(join(tmp, "changes"));
mkdirSync(join(tmp, "src/lib"), { recursive: true });
copyFileSync("src/lib/changelog.ts", join(tmp, "src/lib/changelog.ts"));
for (const f of readdirSync("changes")) if (f !== "README.md") copyFileSync(join("changes", f), join(tmp, "changes", f));
const loadChanges = () =>
  readdirSync(join(tmp, "changes")).filter((f) => f.endsWith(".md")).sort()
    .map((f) => parseChangeFile(readFileSync(join(tmp, "changes", f), "utf8"), f.replace(/\.md$/, "")));
const asEntries = realHistory as unknown as ChangelogEntry[];
const day1 = mergeChangelog(buildEntries(loadChanges(), { history: realHistory }) as ChangelogEntry[], asEntries);
stored = "0.1.402";
assert.ok(shows(day1) > 0, "day1 release shows");
assert.equal(stored, "0.1.404", "day1 dismissed at 0.1.404");
assert.equal(shows(day1), 0);
const run = (slug: string) =>
  execFileSync(process.execPath, ["scripts/new-change.mjs", slug], { env: { ...process.env, PF_ROOT: tmp }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
assert.match(run("tuesday-feature"), /version 0\.1\.405/);
const created = readFileSync(join(tmp, "changes/tuesday-feature.md"), "utf8");
assert.match(created, /^date: \d{4}-\d{2}-\d{2}$/m);
writeFileSync(join(tmp, "changes/tuesday-feature.md"), created.replace(/headline: .*/, "headline: Brand new Tuesday feature").replace(/ {2}- TODO.*/, "  - NEW THING"));
assert.throws(() => run("tuesday-feature"), "refuses to overwrite");
const day2 = mergeChangelog(buildEntries(loadChanges(), { history: realHistory }) as ChangelogEntry[], asEntries);
const newOnDay2 = newerEntries(day2, stored);
assert.equal(newOnDay2.length, 1, "day2 shows exactly the new note");
assert.deepEqual(newOnDay2[0].highlights, ["NEW THING"]);
assert.equal(shows(day2), 1);
assert.equal(shows(day2), 0, "and only once");
assert.match(run("wednesday"), /version 0\.1\.406/, "next note keeps climbing");

console.log("changelog-generator: all passed");
