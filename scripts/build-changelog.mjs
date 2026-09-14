#!/usr/bin/env node
// Builds src/lib/changelog.generated.ts from changes/*.md. Runs on predev/prebuild.
// Idempotent: only writes when the output would change.
//   node scripts/build-changelog.mjs          write if changed
//   node scripts/build-changelog.mjs --check  exit 1 if the committed file is stale
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseChangeFile, readHistory, buildEntries, renderModule, historyWarnings } from "./changelog-lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const changesDir = join(root, "changes");
const outFile = join(root, "src/lib/changelog.generated.ts");
const check = process.argv.includes("--check");

const history = readHistory(readFileSync(join(root, "src/lib/changelog.ts"), "utf8"));
const files = existsSync(changesDir)
  ? readdirSync(changesDir).filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md").sort()
  : [];
const changes = files.map((f) => parseChangeFile(readFileSync(join(changesDir, f), "utf8"), f.replace(/\.md$/, "")));
for (const w of historyWarnings(changes, history)) console.warn(`[changelog] WARNING ${w}`);
const entries = buildEntries(changes, { history });
const next = renderModule(entries);
const current = existsSync(outFile) ? readFileSync(outFile, "utf8") : "";

if (current === next) {
  console.log(`[changelog] up to date (${entries.length} generated entr${entries.length === 1 ? "y" : "ies"} from ${files.length} change file(s))`);
} else if (check) {
  console.error("[changelog] src/lib/changelog.generated.ts is stale — run `node scripts/build-changelog.mjs` and commit it.");
  process.exit(1);
} else {
  writeFileSync(outFile, next);
  console.log(`[changelog] wrote ${entries.length} generated entr${entries.length === 1 ? "y" : "ies"}: ${entries.map((e) => e.version).join(", ") || "(none)"}`);
}
