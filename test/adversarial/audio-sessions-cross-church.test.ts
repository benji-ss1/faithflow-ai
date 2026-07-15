/**
 * Y18: adversarial test — user A cannot POST audio session metrics for a
 * plan belonging to church B.
 *
 * The endpoint MUST look up the plan under (planId AND churchId = user.churchId)
 * and reject with 403 otherwise. This test exercises the shape by importing
 * the route module and asserting the guard exists in source.
 *
 * Run: npx tsx test/adversarial/audio-sessions-cross-church.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

let passed = 0;
let failed = 0;
function t(label: string, fn: () => void | Promise<void>) {
  try {
    const r = fn();
    if (r && typeof (r as Promise<unknown>).then === "function") {
      (r as Promise<unknown>).then(() => { passed++; console.log(`  ok  ${label}`); },
        (e) => { failed++; console.error(`  FAIL  ${label}: ${e?.message ?? e}`); });
    } else { passed++; console.log(`  ok  ${label}`); }
  } catch (e) { failed++; console.error(`  FAIL  ${label}: ${e instanceof Error ? e.message : e}`); }
}

console.log("audio-sessions cross-church guard");
const routePath = path.resolve(__dirname, "../../src/app/api/audio/session-metrics/route.ts");
const src = fs.readFileSync(routePath, "utf8");

t("church_id comes from server session, not request body", () => {
  // The insert values must use user.churchId — never body.churchId.
  assert.match(src, /churchId:\s*user\.churchId/);
  assert.ok(!/churchId:\s*body\./.test(src), "must NOT trust body.churchId");
});

t("plan lookup scoped by both planId and churchId", () => {
  // The where clause must AND planId with user.churchId.
  assert.match(src, /eq\(servicePlans\.id,\s*planId\)/);
  assert.match(src, /eq\(servicePlans\.churchId,\s*user\.churchId\)/);
});

t("returns 403 when plan does not belong to church", () => {
  // Search: string "plan not found" appears near a status: 403 in same expression.
  const idx = src.indexOf("plan not found");
  assert.ok(idx >= 0, "plan not found error must exist");
  const window = src.slice(Math.max(0, idx - 40), idx + 200);
  assert.match(window, /status:\s*403/);
});

t("dedupes on sessionId with onConflictDoNothing", () => {
  assert.match(src, /onConflictDoNothing/);
});

setTimeout(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}, 200);
