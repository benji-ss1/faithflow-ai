/**
 * POST /api/themes/[id]/apply sets the church's MAIN theme. Since 2026-09-23
 * church defaults are admin-only (manage_church); live apply no longer uses it.
 *
 * Run: npx tsx test/adversarial/theme-apply-capability.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasCap } from "../../src/lib/session";

const route = readFileSync("src/app/api/themes/[id]/apply/route.ts", "utf8");
assert.match(route, /hasCap\(user\.role, "manage_church"\)/, "apply route gates on manage_church (2026-09-23: main theme is admin-only)");
assert.match(route, /status: 403/, "apply route returns 403 when refused");
assert.match(route, /eq\(themes\.churchId, user\.churchId\)/, "apply route stays church-scoped");

assert.equal(hasCap("admin", "manage_church"), true, "admin may set the main theme");
for (const role of ["operator", "volunteer", "pastor", "viewer", "unknown"]) {
  assert.equal(hasCap(role, "manage_church"), false, `${role} is refused`);
}
const actions = readFileSync("src/lib/actions.ts", "utf8");
const sdt = actions.slice(actions.indexOf("export async function setDefaultTheme"), actions.indexOf("export async function setDefaultTheme") + 800);
assert.match(sdt, /hasCap\(user\.role, "manage_church"\)/, "setDefaultTheme (the star) is admin-only");
console.log("theme-apply-capability: all passed");
