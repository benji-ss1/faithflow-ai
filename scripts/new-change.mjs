#!/usr/bin/env node
// Creates changes/<slug>.md stamped with the NEXT version (one patch above the
// highest version across src/lib/changelog.ts history + every existing change
// file) and today's date, so a new note always lands in a release nobody has
// dismissed yet.
//   npm run changes:new -- <slug>
// PF_ROOT overrides the repo root (tests).
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { readHistory, nextChangeVersion, sniffVersion, classifyChangeFiles, isValidVersion, versionsOnRef } from "./changelog-lib.mjs";

const root = process.env.PF_ROOT || join(dirname(fileURLToPath(import.meta.url)), "..");
const slug = process.argv[2];
if (!slug || !/^[a-z0-9][a-z0-9-]{0,80}$/.test(slug)) {
  console.error("Usage: npm run changes:new -- <slug>   (lowercase letters, digits, dashes)");
  process.exit(1);
}
const changesDir = join(root, "changes");
const file = join(changesDir, `${slug}.md`);
if (existsSync(file)) {
  console.error(`changes/${slug}.md already exists`);
  process.exit(1);
}
const histPath = join(root, "src/lib/changelog.ts");
const history = existsSync(histPath) ? readHistory(readFileSync(histPath, "utf8")) : [];
const versions = existsSync(changesDir)
  ? classifyChangeFiles(readdirSync(changesDir)).files
      .map((f) => sniffVersion(readFileSync(join(changesDir, f), "utf8")))
      .filter(Boolean)
  : [];
// The desktop app version (package.json) can run ahead of the notes; a note
// below it would sort under what a desktop user already has, so start above it.
try {
  const pkgVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  if (isValidVersion(pkgVersion)) versions.push(pkgVersion);
} catch { /* no package.json (tests) */ }
// ALSO consult the base branch, not just this working tree.
//
// Reading only local files meant a branch that was behind main — or two
// branches open at the same time — minted a number main had already used. The
// loser's note then merged under the winner's headline and disappeared from
// What's New. Checking the remote makes a fresh note start correct; if main
// moves AFTER this, `npm run changes:bump` fixes it in one command.
const gitq = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const baseRef = process.env.CHANGES_BASE || "origin/main";
try {
  // Best-effort refresh so a stale local ref does not defeat the point.
  try { execFileSync("git", ["fetch", "--quiet", "origin", "main"], { cwd: root, stdio: "ignore" }); } catch { /* offline */ }
  const remote = versionsOnRef(gitq, baseRef);
  if (remote.length > 0) versions.push(...remote);
  else console.warn(`[changes] could not read ${baseRef} — version is based on local files only`);
} catch {
  console.warn(`[changes] could not read ${baseRef} (offline or no remote) — version is based on local files only`);
}

const version = nextChangeVersion(history, versions);
const d = new Date();
const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

mkdirSync(changesDir, { recursive: true });
writeFileSync(
  file,
  `---
headline: TODO one plain sentence the operator will understand
audience: operator
version: ${version}
date: ${today}
highlights:
  - TODO what the operator SEES change.
---
`,
);
console.log(`created changes/${slug}.md (version ${version}, date ${today}) — fill in the headline and highlights`);
