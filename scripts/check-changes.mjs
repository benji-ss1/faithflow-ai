#!/usr/bin/env node
// Fails (in CI) when files under src/ changed vs the merge base but no
// changes/*.md was added/edited and no "no-user-change" marker is present in
// the PR title/body (PR_TITLE / PR_BODY env) or any commit message in range.
// Locally it only WARNS (exit 0) unless CI=true or --strict is passed.
import { execSync } from "node:child_process";

const strict = process.env.CI === "true" || process.argv.includes("--strict");
const sh = (cmd) => execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const fail = (msg) => {
  console[strict ? "error" : "warn"](`[check:changes] ${msg}`);
  process.exit(strict ? 1 : 0);
};

const baseRef = process.env.CHANGES_BASE || (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/main");
let base;
try {
  base = sh(`git merge-base ${baseRef} HEAD`);
} catch {
  console.warn(`[check:changes] cannot find merge base with ${baseRef} — skipping`);
  process.exit(0);
}

const changed = sh(`git diff --name-only ${base}...HEAD`).split("\n").filter(Boolean);
const srcChanged = changed.filter((f) => f.startsWith("src/") && f !== "src/lib/changelog.generated.ts");
if (srcChanged.length === 0) {
  console.log("[check:changes] no src/ changes — ok");
  process.exit(0);
}
if (changed.some((f) => /^changes\/(?!README\.md$).+\.md$/i.test(f))) {
  console.log("[check:changes] changes/*.md present — ok");
  process.exit(0);
}
const messages = [process.env.PR_TITLE || "", process.env.PR_BODY || "", sh(`git log --format=%B ${base}..HEAD`)].join("\n");
if (/no-user-change/i.test(messages)) {
  console.log("[check:changes] no-user-change marker found — ok");
  process.exit(0);
}
fail(
  `${srcChanged.length} file(s) under src/ changed but no changes/<slug>.md was added.\n` +
    `  Add one (see changes/README.md) so What's New updates, or put "no-user-change" in the PR description / a commit message.`,
);
