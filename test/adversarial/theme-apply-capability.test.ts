/**
 * POST /api/themes/[id]/apply sets the church's default theme. Operators and
 * volunteers use it from the operator console mid-service, so they must keep
 * access; read-only roles (pastor, viewer) must be refused.
 *
 * Run: npx tsx test/adversarial/theme-apply-capability.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasCap } from "../../src/lib/session";

const route = readFileSync("src/app/api/themes/[id]/apply/route.ts", "utf8");
assert.match(route, /hasCap\(user\.role, "operate_services"\)/, "apply route gates on operate_services");
assert.match(route, /status: 403/, "apply route returns 403 when refused");
assert.match(route, /eq\(themes\.churchId, user\.churchId\)/, "apply route stays church-scoped");

for (const role of ["admin", "operator", "volunteer"]) {
  assert.equal(hasCap(role, "operate_services"), true, `${role} keeps theme apply`);
}
for (const role of ["pastor", "viewer", "unknown"]) {
  assert.equal(hasCap(role, "operate_services"), false, `${role} is refused`);
}
console.log("theme-apply-capability: all passed");
