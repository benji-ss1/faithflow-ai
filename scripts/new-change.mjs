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
import { readHistory, nextChangeVersion, sniffVersion } from "./changelog-lib.mjs";

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
  ? readdirSync(changesDir)
      .filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md")
      .map((f) => sniffVersion(readFileSync(join(changesDir, f), "utf8")))
      .filter(Boolean)
  : [];
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
