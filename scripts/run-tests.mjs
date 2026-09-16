#!/usr/bin/env node
// Runs standalone test files (each is `npx tsx <file>`, exit 0 = pass) with a
// per-file timeout, and prints a pass/fail summary.
//   node scripts/run-tests.mjs                 -> files listed in test/suites/output.txt
//   node scripts/run-tests.mjs --suite <name>  -> test/suites/<name>.txt
//   node scripts/run-tests.mjs --all           -> every test/**/*.test.ts(x) except e2e
//   node scripts/run-tests.mjs <file>...       -> just those files
// Exit code is non-zero if any file fails or times out.
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const TIMEOUT_MS = Number(process.env.TEST_TIMEOUT_MS || 120_000);
const CONCURRENCY = Number(process.env.TEST_CONCURRENCY || 4);

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function listFiles(argv) {
  if (argv.includes("--all")) {
    return walk(join(root, "test"))
      .map((p) => relative(root, p))
      .filter((p) => /\.test\.tsx?$/.test(p) && !p.includes("e2e"))
      .sort();
  }
  const i = argv.indexOf("--suite");
  const explicit = argv.filter((a, idx) => !a.startsWith("--") && !(i >= 0 && idx === i + 1));
  if (explicit.length) return explicit;
  const suite = i >= 0 ? argv[i + 1] : "output";
  return readFileSync(join(root, "test/suites", `${suite}.txt`), "utf8")
    .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
}

function runOne(file) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn("npx", ["tsx", file], { cwd: root, env: process.env });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    const timer = setTimeout(() => { child.kill("SIGKILL"); }, TIMEOUT_MS);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const status = signal === "SIGKILL" ? "timeout" : code === 0 ? "pass" : "fail";
      resolve({ file, status, ms: Date.now() - started, out });
    });
  });
}

const files = listFiles(process.argv.slice(2));
const results = [];
let next = 0;
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, async () => {
  while (next < files.length) {
    const r = await runOne(files[next++]);
    results.push(r);
    console.log(`${r.status === "pass" ? "PASS" : r.status.toUpperCase()}  ${r.file}  (${r.ms}ms)`);
  }
}));

const failed = results.filter((r) => r.status !== "pass");
for (const r of failed) {
  console.log(`\n----- ${r.status.toUpperCase()}: ${r.file} -----\n${r.out.split("\n").slice(-25).join("\n")}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
