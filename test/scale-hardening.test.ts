/**
 * SCALE HARDENING for the 20+ concurrent-church target (2026-09-21).
 *
 * Locks three things that were verified missing on origin/main:
 *   1. The Fly audio bridge has process-level crash guards. ONE Node process
 *      serves EVERY church's live audio; since Node 15 an unhandled promise
 *      rejection terminates the process by default, and `dgOnMessage` is an
 *      async EventEmitter listener that nothing awaits. Without a guard, one
 *      church's failed DB insert kills live detection for all of them.
 *   2. The retention prune is church-scoped and bounded per run.
 *   3. The prune cron is actually wired (it existed only as a script nothing
 *      ever invoked, so `transcript_retention_days` was never enforced).
 *
 * Run: npx tsx test/scale-hardening.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

let pass = 0, fail = 0;
const check = (n: string, fn: () => void) => {
  try { fn(); console.log(`  PASS  ${n}`); pass++; }
  catch (e) { console.error(`  FAIL  ${n}\n        ${(e as Error).message}`); fail++; }
};
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

console.log("the shared audio bridge survives one church's error:");
check("audio-server registers BOTH process-level guards", () => {
  const src = read("scripts/audio-server.ts");
  assert.match(src, /process\.on\("unhandledRejection"/, "an unhandled rejection would kill every church's audio");
  assert.match(src, /process\.on\("uncaughtException"/, "an uncaught exception would kill every church's audio");
});

check("Node really does exit on an unhandled rejection WITHOUT a guard", () => {
  // Proves the risk is real on this Node version, not theoretical.
  let exitCode = 0;
  try {
    execFileSync(process.execPath, ["-e", "Promise.reject(new Error('boom')); setTimeout(()=>{},50);"],
      { stdio: "pipe" });
  } catch (e) { exitCode = (e as { status?: number }).status ?? 0; }
  assert.notEqual(exitCode, 0, "if this passes with 0, Node's default changed and the guard's rationale needs revisiting");
});

check("…and survives WITH the guard the bridge installs", () => {
  const out = execFileSync(process.execPath, ["-e",
    "process.on('unhandledRejection',()=>{console.log('absorbed')});" +
    "Promise.reject(new Error('boom'));" +
    "setTimeout(()=>{console.log('alive');process.exit(0)},50);"],
    { stdio: "pipe" }).toString();
  assert.match(out, /absorbed/);
  assert.match(out, /alive/, "the process must still be serving the other churches");
});

console.log("the retention prune cannot cross tenants or run away:");
check("prune deletes only within one church, via service_plans", () => {
  const src = read("src/lib/server/transcript-retention.ts");
  assert.match(src, /sp\.church_id = \$\{c\.church_id\}/, "church scoping is mandatory (CLAUDE.md rule 5)");
  assert.match(src, /JOIN service_plans sp ON sp\.id = ts\.service_plan_id/);
});
check("prune is bounded per run so a first backlog can't blow the time budget", () => {
  const src = read("src/lib/server/transcript-retention.ts");
  assert.match(src, /LIMIT \$\{maxRows\}/);
  assert.match(src, /DEFAULT_MAX_ROWS_PER_CHURCH/);
});
check("one church's failure does not abandon the rest", () => {
  const src = read("src/lib/server/transcript-retention.ts");
  assert.match(src, /catch \(e\)/);
  assert.match(src, /errors \+= 1/);
});

console.log("the nightly jobs are actually scheduled:");
check("prune cron is wired in vercel.json and guarded by CRON_SECRET", () => {
  const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
  const paths = vercel.crons.map((c) => c.path);
  assert.ok(paths.includes("/api/cron/prune-transcripts"), "retention was never enforced before this was wired");
  const route = read("src/app/api/cron/prune-transcripts/route.ts");
  assert.match(route, /CRON_SECRET/);
  assert.match(route, /not configured.*401|401.*not configured/s, "a DELETE endpoint must fail CLOSED");
});
check("the script and the cron share ONE implementation", () => {
  const script = read("scripts/prune-transcripts.ts");
  assert.match(script, /transcript-retention/, "two copies of a delete path will drift");
});

console.log("the hot tables are indexed:");
check("transcript_segments and detected_references have indexes", () => {
  const schema = read("src/lib/db/schema.ts");
  assert.match(schema, /idx_transcript_segments_plan_ts/, "fastest-growing table in the schema");
  assert.match(schema, /idx_detected_references_segment/, "unindexed ON DELETE CASCADE = O(deleted x table)");
});
check("the migration builds them CONCURRENTLY (never lock the live write path)", () => {
  const sqlFile = read("docs/migrations/2026-09-21-scale-indexes-transcripts.sql");
  const creates = sqlFile.split("\n").filter((l) => l.trim().startsWith("CREATE INDEX"));
  assert.equal(creates.length, 2);
  for (const c of creates) assert.match(c, /CONCURRENTLY/, "a plain CREATE INDEX stalls detection for every church");
  assert.match(sqlFile, /DROP INDEX CONCURRENTLY IF EXISTS/, "rollback is written first (CLAUDE.md rule 0d)");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
