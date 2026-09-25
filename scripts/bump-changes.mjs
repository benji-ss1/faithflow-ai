#!/usr/bin/env node
/**
 * Re-number this branch's unreleased What's New notes so they sit above the
 * base branch. `npm run changes:bump`
 *
 * WHY THIS EXISTS
 *   A note's version is baked in when the note is created, and the CI gate
 *   requires it to be strictly above the newest version on the MERGE BASE. So
 *   the moment main ships a note — or you merge main in — every unreleased
 *   note on your branch can become invalid, through no fault of its author.
 *   That happened four times in a single day, and each time the fix was to
 *   hand-edit several files and regenerate. This does it in one command.
 *
 *   It cannot be done automatically in CI: the version is deliberately frozen
 *   once a note ships, because an operator who dismissed What's New for a
 *   version must never be shown that version again.
 *
 * SAFE BY DESIGN: only notes that are NOT on the base are touched (a released
 * note's version is frozen), only notes at or below the base's newest are
 * moved, and relative order is preserved. Prints a plan; --dry-run stops there.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readHistory, sniffVersion, classifyChangeFiles, maxVersion, versionsOnRef, renumberAbove, isValidVersion } from "./changelog-lib.mjs";

const root = process.env.PF_ROOT || join(dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

const baseRef = process.env.CHANGES_BASE || "origin/main";
try { execFileSync("git", ["fetch", "--quiet", "origin", "main"], { cwd: root, stdio: "ignore" }); } catch { /* offline */ }

let base;
try {
  base = git("merge-base", baseRef, "HEAD");
} catch {
  console.error(`[changes] cannot find the merge base with ${baseRef}. Fetch it first, then retry.`);
  process.exit(1);
}

// The floor: the newest version anyone could already have seen. Both the merge
// base AND the current tip of the base branch count — the tip is what this
// branch will actually merge into.
const floorCandidates = [...versionsOnRef(git, base), ...versionsOnRef(git, baseRef)];
try {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  if (isValidVersion(pkg)) floorCandidates.push(pkg);
} catch { /* no package.json */ }
const floor = maxVersion(floorCandidates.filter(Boolean));

// Notes that exist on this branch but NOT on the base are the unreleased ones.
const changesDir = join(root, "changes");
const localFiles = existsSync(changesDir) ? classifyChangeFiles(readdirSync(changesDir)).files : [];
// RELEASED = present on the merge base OR on the base TIP.
//
// Using the merge base alone was wrong, and a dogfood run caught it: right
// after `git merge origin/main`, notes that main had already SHIPPED are
// absent from the merge base (it predates them) but present in the tree — so
// they looked unreleased and got renumbered. That silently rewrites someone
// else's shipped version, which is the one thing this file must never do:
// an operator who dismissed What's New for that version would never see it.
const baseFiles = new Set();
for (const ref of [base, baseRef]) {
  try {
    for (const f of git("ls-tree", "--name-only", "-r", ref, "changes/").split("\n").filter(Boolean)) {
      baseFiles.add(f.replace(/^changes\//, ""));
    }
  } catch { /* that ref has no changes/ */ }
}

const notes = [];
for (const f of localFiles) {
  if (baseFiles.has(f)) continue;              // already released — version frozen
  const text = readFileSync(join(changesDir, f), "utf8");
  const version = sniffVersion(text);
  if (version) notes.push({ file: f, version });
}

if (notes.length === 0) {
  console.log(`[changes] no unreleased notes on this branch — nothing to do.`);
  process.exit(0);
}

const plan = renumberAbove(notes, floor);
if (plan.length === 0) {
  console.log(`[changes] all ${notes.length} unreleased note(s) already sit above ${floor} — nothing to do.`);
  process.exit(0);
}

console.log(`[changes] newest on ${baseRef}: ${floor}`);
for (const p of plan) console.log(`  ${p.file}: ${p.from} -> ${p.to}`);
if (dryRun) { console.log("[changes] --dry-run: nothing written."); process.exit(0); }

for (const p of plan) {
  const path = join(changesDir, p.file);
  const text = readFileSync(path, "utf8");
  // Only the frontmatter `version:` line, anchored, so a version mentioned in
  // a highlight is never rewritten.
  const next = text.replace(/^version:[ \t]*.*$/m, `version: ${p.to}`);
  if (next === text) {
    console.error(`[changes] could not rewrite the version line in changes/${p.file} — fix it by hand.`);
    process.exit(1);
  }
  writeFileSync(path, next);
}
console.log(`[changes] renumbered ${plan.length} note(s). Now run: node scripts/build-changelog.mjs`);
