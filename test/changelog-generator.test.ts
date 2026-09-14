// Run: npx tsx test/changelog-generator.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseChangeFile, readHistory, buildEntries, renderModule, bumpPatch } from "../scripts/changelog-lib.mjs";
import { mergeChangelog, type ChangelogEntry } from "../src/lib/changelog-types";
import { CHANGELOG } from "../src/lib/changelog";
import { GENERATED_CHANGELOG } from "../src/lib/changelog.generated";
import { newerEntries, forwardLastSeen, cmpVersion } from "../src/lib/whats-new";

const md = (fm: string) => `---\n${fm}\n---\n`;

// parse
const a = parseChangeFile(md("headline: Alpha thing\naudience: admin\norder: 2\nhighlights:\n  - one: with colon\n  - \"two\""), "alpha");
assert.equal(a.headline, "Alpha thing");
assert.equal(a.audience, "admin");
assert.deepEqual(a.highlights, ["one: with colon", "two"]);
assert.deepEqual(parseChangeFile(md("headline: Solo"), "solo").highlights, ["Solo"], "highlights default to headline");
assert.throws(() => parseChangeFile(md("audience: operator"), "x"), /headline is required/);
assert.throws(() => parseChangeFile(md("headline: h\naudience: everyone"), "x"), /audience/);
assert.throws(() => parseChangeFile(md("headline: h\nversion: v1"), "x"), /version/);
assert.throws(() => parseChangeFile("no frontmatter", "x"), /frontmatter/);
assert.throws(() => parseChangeFile(md("headline: h\nbogus: 1"), "x"), /unknown key/);

// build: grouping, ordering, next-version, dedupe
const history = [{ version: "0.1.402", headline: "Old" }, { version: "0.1.401", headline: "Older" }];
const b = parseChangeFile(md("headline: Beta\norder: 1\ndate: 2026-09-01"), "beta");
const pinned = parseChangeFile(md("headline: Pinned\nversion: 0.1.403\ndate: 2026-09-02"), "pinned");
const merged = parseChangeFile(md("headline: Old"), "already-merged");
const entries = buildEntries([a, b, pinned, merged], { pkgVersion: "0.1.380", history, today: "2026-09-14" });
assert.deepEqual(entries.map((e: ChangelogEntry) => e.version), ["0.1.404", "0.1.403"], "unpinned go past newest known; newest-first");
assert.equal(entries[0].headline, "Beta", "order:1 leads the group");
assert.deepEqual(entries[0].highlights, ["Beta", "one: with colon", "two"]);
assert.equal(entries[0].date, "2026-09-01");
assert.ok(!JSON.stringify(entries).includes('"Old"'), "headline already in history is not duplicated");
assert.equal(buildEntries([b], { pkgVersion: "0.2.0", history, today: "t" })[0].version, "0.2.0", "newer package.json version wins");
assert.throws(() => buildEntries([parseChangeFile(md("headline: New\nversion: 0.1.402"), "c")], { pkgVersion: "0", history, today: "t" }), /already exists/);
assert.deepEqual(buildEntries([], { pkgVersion: "0.1.0", history, today: "t" }), []);
// determinism (idempotent output)
assert.equal(renderModule(entries), renderModule(buildEntries([merged, pinned, b, a], { pkgVersion: "0.1.380", history, today: "2026-09-14" })));
assert.equal(bumpPatch("0.1.9"), "0.1.10");

// merge: dedupe by version (history wins) + newest-first
const H: ChangelogEntry[] = [{ version: "0.1.402", date: "", headline: "hist", highlights: [] }];
const G: ChangelogEntry[] = [
  { version: "0.1.402", date: "", headline: "gen-dup", highlights: [] },
  { version: "0.1.410", date: "", headline: "gen", highlights: [] },
];
assert.deepEqual(mergeChangelog(G, H).map((e) => e.headline), ["gen", "hist"]);

// real data: shape valid, newest-first, unique versions, generated entries present
for (const e of CHANGELOG) {
  assert.ok(e.version && e.date && e.headline && Array.isArray(e.highlights) && e.highlights.length, `valid ${e.version}`);
}
for (let i = 1; i < CHANGELOG.length; i++) assert.ok(cmpVersion(CHANGELOG[i - 1].version, CHANGELOG[i].version) > 0, `ordered at ${i}`);
for (const g of GENERATED_CHANGELOG) assert.ok(CHANGELOG.includes(g), `generated ${g.version} merged`);
// the 0.1.403 content moved to changes/ is not lost
const all = JSON.stringify(CHANGELOG);
assert.ok(all.includes("A full editor for your OBS live-stream words"));
assert.ok(all.includes("Over your camera now has a Layout choice"));
// history source parse covers the curated file
assert.ok(readHistory(readFileSync("src/lib/changelog.ts", "utf8")).length > 300);

// WhatsNew: a new generated entry shows exactly once
let stored: string | null = "0.1.402";
const shows = () => {
  const n = newerEntries(CHANGELOG, stored);
  if (!n.length) return false;
  stored = forwardLastSeen(stored, n[0].version);
  return true;
};
assert.equal(shows(), true);
assert.equal(stored, CHANGELOG[0].version);
assert.equal(shows(), false);
console.log("changelog-generator: all passed");
