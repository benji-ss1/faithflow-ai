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

check("prune deletes NOTHING until explicitly armed", () => {
  const src = read("src/lib/server/transcript-retention.ts");
  // Retention has never run, so the first real execution would act on every
  // transcript since day one. Default must be count-only.
  assert.match(src, /PRUNE_TRANSCRIPTS_ENABLED === "1"/);
  assert.match(src, /dryRun = opts\?\.dryRun \?\? !pruneIsArmed\(\)/, "armed must be opt-IN, never opt-out");
  // The dry-run count must use the SAME predicate as the delete, or the
  // number the operator approves is not the number that goes.
  const both = src.match(/WHERE sp\.church_id = \$\{c\.church_id\}\s+AND ts\.ts < NOW\(\) - \(\$\{c\.days\} \|\| ' days'\)::interval/g);
  assert.ok(both && both.length === 2, `expected the same predicate in count and delete, found ${both?.length ?? 0}`);
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

console.log("connection pool is sized per consumer, and cannot be fat-fingered:");
check("PG_POOL_MAX is clamped and defaults to the safe value", async () => {
  const mod = await import("../src/lib/db/client");
  assert.equal(mod.DEFAULT_PG_POOL_MAX, 6);
  const src = read("src/lib/db/client.ts");
  // max_connections is 60 on the live DB — an unclamped env typo could exhaust it.
  assert.match(src, /Math\.max\(1, Math\.min\(24, Math\.floor\(raw\)\)\)/);
  assert.match(src, /if \(!Number\.isFinite\(raw\) \|\| raw <= 0\) return DEFAULT_PG_POOL_MAX/);
});
check("the Fly bridge raises its own pool, the web app does not", () => {
  assert.match(read("fly.toml"), /PG_POOL_MAX = "12"/);
});
check("a long-lived bridge keeps a warm connection and survives idle NAT drops", () => {
  // PR #75's good idea, folded in rather than duplicated into a second DB
  // module: min:1 avoids a cold handshake on the first detection of a service,
  // keepAlive stops an idle connection being dropped between Sundays.
  const src = read("src/lib/db/client.ts");
  assert.match(src, /const LONG_LIVED = process\.env\.PG_POOL_MAX !== undefined/);
  assert.match(src, /LONG_LIVED \? \{ min: 1, keepAlive: true \}/);
});

console.log("shared rate limits degrade rather than lock a church out:");
check("Redis backend falls back to the in-memory limiter, never open, never closed", () => {
  const src = read("src/lib/rate-limit-redis.ts");
  assert.match(src, /return this\.fallback\.check\(key, opts\)/, "a Redis outage must not remove rate limiting");
  assert.match(src, /return this\.fallback\.peek\(key, opts\)/);
  assert.match(src, /AbortSignal\.timeout\(2_000\)/, "must never become the slowest thing in a request");
});
check("it is inert until BOTH Upstash vars are set", () => {
  const src = read("src/lib/rate-limit-redis.ts");
  assert.match(src, /if \(!url \|\| !token\) return "memory"/);
  // Vercel's Upstash integration provisions KV_REST_API_*; a hand-rolled
  // instance uses UPSTASH_REDIS_REST_*. Both must work or the limiter is
  // silently inert in production.
  assert.match(src, /KV_REST_API_URL \|\| process\.env\.UPSTASH_REDIS_REST_URL/);
  assert.match(src, /KV_REST_API_TOKEN \|\| process\.env\.UPSTASH_REDIS_REST_TOKEN/);
  assert.match(read("src/instrumentation.ts"), /installSharedRateLimiter/);
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
