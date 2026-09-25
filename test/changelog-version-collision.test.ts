/**
 * What's New version collisions — the renumber logic and base-ref reading.
 *
 * Run: npx tsx test/changelog-version-collision.test.ts
 *
 * WHY: a note's version is baked in at creation from LOCAL files only, while
 * CI requires it to be strictly above the newest version on the merge base.
 * So main shipping anything — or two branches open at once — silently
 * invalidated a note, and the loser's note merged under the winner's headline
 * and vanished from What's New. It happened four times in one day.
 *
 * These pin the two halves of the fix: reading the base ref, and renumbering
 * without trading one collision for another.
 */
import assert from "node:assert";
import { renumberAbove, versionsOnRef } from "../scripts/changelog-lib.mjs";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n         ${(e as Error).message}`); fail++; }
}

const n = (file: string, version: string) => ({ file, version });
const moves = (notes: { file: string; version: string }[], floor: string) =>
  renumberAbove(notes, floor).map((m) => `${m.file}:${m.from}->${m.to}`);

console.log("\nWhat's New — version collisions\n");

check("a stale note is moved to JUST above the floor", () => {
  assert.deepStrictEqual(moves([n("a.md", "0.1.400")], "0.1.532"), ["a.md:0.1.400->0.1.533"]);
});

check("several stale notes keep their relative order", () => {
  assert.deepStrictEqual(
    moves([n("b.md", "0.1.506"), n("a.md", "0.1.505")], "0.1.507"),
    ["a.md:0.1.505->0.1.508", "b.md:0.1.506->0.1.509"],
  );
});

check("a note already above the floor is LEFT ALONE (no version churn)", () => {
  assert.deepStrictEqual(moves([n("a.md", "0.1.999")], "0.1.507"), []);
});

check("a moved note never lands on a version another note already holds", () => {
  // 0.1.508 is taken by a note that does not need to move.
  const out = renumberAbove([n("a.md", "0.1.505"), n("keep.md", "0.1.508")], "0.1.507");
  assert.deepStrictEqual(out.map((m) => m.to), ["0.1.509"]);
});

check("moved notes never collide with EACH OTHER", () => {
  const out = renumberAbove([n("a.md", "0.1.1"), n("b.md", "0.1.2"), n("c.md", "0.1.3")], "0.1.507");
  const tos = out.map((m) => m.to);
  assert.strictEqual(new Set(tos).size, tos.length, `duplicate target versions: ${tos}`);
});

check("nothing to renumber is a clean no-op, not an error", () => {
  assert.deepStrictEqual(renumberAbove([], "0.1.507"), []);
});

check("the exact four-times-a-day scenario: main ships while you are writing", () => {
  // Branch created at 0.1.505; main then ships 0.1.505, 0.1.506, 0.1.507.
  const out = renumberAbove([n("mine.md", "0.1.505")], "0.1.507");
  assert.deepStrictEqual(out, [{ file: "mine.md", from: "0.1.505", to: "0.1.508" }]);
});

// --- reading a git ref ------------------------------------------------------

check("versionsOnRef reads BOTH the curated history and the change files", () => {
  const fakeGit = (cmd: string, ...args: string[]) => {
    if (cmd === "show" && args[0].endsWith(":src/lib/changelog.ts")) {
      return `export const CHANGELOG_HISTORY: ChangelogEntry[] = [\n  { version: "0.1.100", date: "2026-01-01", headline: "H", highlights: [] },\n];`;
    }
    if (cmd === "ls-tree") return "changes/a.md\nchanges/b.md";
    if (cmd === "show" && args[0].endsWith(":changes/a.md")) return "---\nversion: 0.1.200\n---";
    if (cmd === "show" && args[0].endsWith(":changes/b.md")) return "---\nversion: 0.1.300\n---";
    throw new Error("unexpected git call");
  };
  const out = versionsOnRef(fakeGit, "origin/main");
  assert.ok(out.includes("0.1.100"), "missed the curated history");
  assert.ok(out.includes("0.1.200") && out.includes("0.1.300"), "missed the change files");
});

check("versionsOnRef survives a ref with no history file and no changes dir", () => {
  const brokenGit = () => { throw new Error("does not exist"); };
  assert.deepStrictEqual(versionsOnRef(brokenGit, "origin/main"), []);
});

check("versionsOnRef ignores non-note files in changes/", () => {
  const fakeGit = (cmd: string, ...args: string[]) => {
    if (cmd === "ls-tree") return "changes/README.md\nchanges/nested/x.md\nchanges/a.md";
    if (cmd === "show" && args[0].endsWith(":changes/a.md")) return "---\nversion: 0.1.200\n---";
    if (cmd === "show") return "---\nnot: a note\n---";
    throw new Error("unexpected");
  };
  // README has no version → contributes nothing; nested paths are not notes.
  assert.deepStrictEqual(versionsOnRef(fakeGit, "origin/main"), ["0.1.200"]);
});

// --- the frozen-version invariant (a dogfood run caught this) --------------

check("DOGFOOD BUG: a note released on the base TIP is never renumbered", () => {
  // After `git merge origin/main`, notes main already SHIPPED are absent from
  // the MERGE BASE (which predates them) but present in the tree. Treating
  // "absent from merge base" as "unreleased" rewrote someone else's shipped
  // version — the one thing bump must never do.
  //
  // renumberAbove only sees the notes it is GIVEN, so the invariant lives in
  // which notes bump-changes.mjs collects. This pins the shape of that
  // decision: released notes must be excluded BEFORE renumbering, and once
  // excluded they must not be moved even though they sit below the floor.
  const unreleasedOnly = [{ file: "mine.md", version: "0.1.530" }];
  const out = renumberAbove(unreleasedOnly, "0.1.532");
  assert.deepStrictEqual(out, [{ file: "mine.md", from: "0.1.530", to: "0.1.533" }]);
  assert.ok(!out.some((m) => m.file !== "mine.md"), "renumbered a note it was not given");
});

check("a released note passed in by mistake is still only moved if below the floor", () => {
  // Defence in depth: even if the caller's filtering were wrong, a note that
  // is already ABOVE the floor is left untouched.
  const out = renumberAbove([{ file: "released.md", version: "0.1.999" }], "0.1.532");
  assert.deepStrictEqual(out, []);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
