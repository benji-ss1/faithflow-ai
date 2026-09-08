/**
 * Stale-action recovery detection (Wave 3, item 1).
 * Run: npx tsx test/stale-action.test.ts
 */
import assert from "node:assert/strict";
import { isStaleServerActionError, staleActionRecovery, staleErrorMessage } from "../src/lib/stale-action";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}

// ── Positive: the version-mismatch class ─────────────────────────────────────
check("detects current Next.js wording", () => {
  assert.equal(isStaleServerActionError(new Error('Failed to find Server Action "7f3a2b". This request might be from an older or newer deployment.')), true);
});
check("detects older 'was not found on the server' wording", () => {
  assert.equal(isStaleServerActionError(new Error('Server Action "abc123" was not found on the server')), true);
});
check("detects when signal is only on the deployment sentence", () => {
  assert.equal(isStaleServerActionError(new Error("This request might be from an older or newer deployment")), true);
});
check("detects a plain string error", () => {
  assert.equal(isStaleServerActionError("Failed to find Server Action \"x\""), true);
});
check("detects signal carried on Error.digest", () => {
  const e = Object.assign(new Error("An unexpected response was received from the server."), { digest: "Failed to find Server Action \"z\"" });
  assert.equal(isStaleServerActionError(e), true);
});

// ── Negative: must NOT swallow real failures ─────────────────────────────────
check("ignores a generic network error", () => {
  assert.equal(isStaleServerActionError(new Error("Failed to fetch")), false);
});
check("ignores a normal action failure", () => {
  assert.equal(isStaleServerActionError(new Error("Reorder failed")), false);
});
check("ignores null / undefined", () => {
  assert.equal(isStaleServerActionError(null), false);
  assert.equal(isStaleServerActionError(undefined), false);
});
check("staleErrorMessage handles objects", () => {
  assert.equal(staleErrorMessage({ message: "hi", digest: "there" }), "hi there");
});

// ── Recovery policy ──────────────────────────────────────────────────────────
check("auto-reloads when nothing is live", () => {
  assert.deepEqual(staleActionRecovery({ contentIsLive: false }), { autoReload: true });
});
check("never auto-reloads when content is live", () => {
  assert.deepEqual(staleActionRecovery({ contentIsLive: true }), { autoReload: false });
});
// Reload-loop guard (STRESS 3/6): a reload that lands back on a stale chunk
// (stale service worker) must NOT auto-reload a second time.
check("suppresses a second auto-reload after one already fired", () => {
  assert.deepEqual(staleActionRecovery({ contentIsLive: false, recentlyAutoReloaded: true }), { autoReload: false });
});
check("still auto-reloads the FIRST time (guard not yet armed)", () => {
  assert.deepEqual(staleActionRecovery({ contentIsLive: false, recentlyAutoReloaded: false }), { autoReload: true });
});
check("live content wins over the loop guard (never reloads either way)", () => {
  assert.deepEqual(staleActionRecovery({ contentIsLive: true, recentlyAutoReloaded: false }), { autoReload: false });
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
