#!/usr/bin/env node
// What's New gate, vs the merge base with origin/<base> (CHANGES_BASE overrides):
//  1. Every changes/*.md ADDED in this branch must parse and carry a version
//     strictly above the highest version on the merge base (curated history +
//     change files) — a new note can never join an already-released version.
//  2. When files under src/ changed, at least one changes/*.md must be added
//     or modified AND parse, unless a "no-user-change" marker is present: a
//     line that is exactly `no-user-change` in the PR title/body (PR_TITLE /
//     PR_BODY) or any commit message in range, or a PR label (PR_LABELS,
//     comma-separated).
// Strict (exit 1) when CI=true or --strict; otherwise it only warns.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { parseChangeFile, maxVersion, cmpVersion, sniffVersion, sniffField, badExtMessage, versionsOnRef } from "./changelog-lib.mjs";

const strict = process.env.CI === "true" || process.argv.includes("--strict");
const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const fail = (msg) => {
  console[strict ? "error" : "warn"](`[check:changes] ${msg}`);
  process.exit(strict ? 1 : 0);
};
const isChangeFile = (f) => /^changes\/[^/]+\.md$/.test(f) && f.toLowerCase() !== "changes/readme.md";
const isBadExt = (f) => /^changes\/[^/]+\.md$/i.test(f) && !f.endsWith(".md");
const slugOf = (f) => f.replace(/^changes\//, "").replace(/\.md$/, "");

const baseRef = process.env.CHANGES_BASE || (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/main");
let base;
try {
  base = git("merge-base", baseRef, "HEAD");
} catch {
  fail(`cannot find merge base with ${baseRef} (fetch-depth 0 / fetch the base branch)`);
}

// --no-renames: a renamed note counts as delete + add, so it faces the added-note rule.
const diffNames = (filter) => git("diff", "--no-renames", "--name-only", `--diff-filter=${filter}`, `${base}...HEAD`).split("\n").filter(Boolean);
const changed = git("diff", "--no-renames", "--name-only", `${base}...HEAD`).split("\n").filter(Boolean);
const added = diffNames("A").filter(isChangeFile);
const modified = diffNames("M").filter(isChangeFile);
const addedOrModified = [...added, ...modified];

// Parse the touched change files (as they are at HEAD).
const errors = diffNames("AM").filter(isBadExt).map((f) => badExtMessage(f.replace(/^changes\//, "")));
const parsed = new Map();
for (const f of addedOrModified) {
  try {
    const text = existsSync(f) ? readFileSync(f, "utf8") : git("show", `HEAD:${f}`);
    parsed.set(f, parseChangeFile(text, slugOf(f)));
  } catch (e) {
    errors.push(e.message);
  }
}

// Highest version known on the merge base AND on the base TIP.
//
// The TIP is the load-bearing half, and measuring only the merge base is what
// let the reported bug keep happening:
//   - two branches mint the same number; after the first merges, the second's
//     MERGE BASE still predates it, so the gate stayed green and the note
//     merged under the winner's headline and vanished from What's New;
//   - a branch that never merges main in never sees the base move at all.
// The tip is what this branch actually merges into, so that is what a new note
// must be above. (bump-changes.mjs already used both; the gate did not, and
// that inconsistency WAS the hole.)
const baseNewest = maxVersion([
  ...versionsOnRef(git, base),
  ...versionsOnRef(git, baseRef),
].filter(Boolean));
for (const f of added) {
  const c = parsed.get(f);
  if (c && cmpVersion(c.version, baseNewest) <= 0) {
    // Point at the one-command fix. "Re-create it" meant deleting and
    // rewriting the note by hand — and with several notes on a branch that is
    // several edits, every time main ships anything.
    errors.push(`${f}: version ${c.version} must be above ${baseNewest} (the newest version on ${baseRef}). This happens when ${baseRef} ships a note after yours was written — run \`npm run changes:bump\` to renumber your unreleased notes, then \`node scripts/build-changelog.mjs\`.`);
  }
}
// A note that already exists on the base is released: its version/date are frozen.
for (const f of modified) {
  const c = parsed.get(f);
  if (!c) continue;
  let baseText = "";
  try { baseText = git("show", `${base}:${f}`); } catch { continue; }
  for (const key of ["version", "date"]) {
    const was = sniffField(baseText, key);
    if (was !== undefined && was !== c[key]) {
      errors.push(`${f}: released note version cannot be edited (${key} was ${was} on ${baseRef}, now ${c[key]}) — add a new note with \`npm run changes:new -- <slug>\` instead.`);
    }
  }
}
if (errors.length) fail(`invalid change note(s):\n  ${errors.join("\n  ")}`);

const srcChanged = changed.filter((f) => f.startsWith("src/") && f !== "src/lib/changelog.generated.ts");
if (srcChanged.length === 0) {
  console.log("[check:changes] no src/ changes — ok");
  process.exit(0);
}
if (parsed.size > 0) {
  console.log(`[check:changes] ${parsed.size} valid changes/*.md added/edited — ok`);
  process.exit(0);
}
const labels = (process.env.PR_LABELS || "").split(",").map((s) => s.trim().toLowerCase());
const messages = [process.env.PR_TITLE || "", process.env.PR_BODY || "", git("log", "--format=%B", `${base}..HEAD`)].join("\n");
if (labels.includes("no-user-change") || /^[ \t]*no-user-change[ \t]*\r?$/m.test(messages)) {
  console.log("[check:changes] no-user-change marker found — ok");
  process.exit(0);
}
fail(
  `${srcChanged.length} file(s) under src/ changed but no valid changes/<slug>.md was added or edited.\n` +
    `  Run \`npm run changes:new -- <slug>\` (see changes/README.md) so What's New updates, or — if users truly see nothing —\n` +
    `  put a line containing only "no-user-change" in the PR description / a commit message, or add the no-user-change PR label.`,
);
