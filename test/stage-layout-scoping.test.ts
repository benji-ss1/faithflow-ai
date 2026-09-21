// Run: npx tsx test/stage-layout-scoping.test.ts
//
// Rule 5: church_id scoping is mandatory on every DB write for a tenant-owned
// table. stage_layouts and stage_screens are new tenant tables, so every action
// that touches them must filter on the CALLER'S church — an id from another
// church must never be readable, updatable or deletable.
//
// This is a SOURCE-level guard (no DB required, so it runs in CI where the
// adversarial DB suite cannot). It reads the action bodies and asserts the
// scoping is present. test/adversarial/* covers the live-DB behaviour.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const actions = readFileSync(new URL("../src/lib/actions.ts", import.meta.url), "utf8");

/** Extract one exported action's body. */
function body(name: string): string {
  const parts = actions.split(`export async function ${name}`);
  assert.ok(parts.length > 1, `${name} must exist`);
  return parts[1].split("\nexport ")[0];
}

const MUTATORS = [
  "createStageLayout", "updateStageLayout", "deleteStageLayout",
  "createStageScreen", "setStageScreenLayout", "renameStageScreen", "deleteStageScreen",
];
const READERS = ["listStageLayouts", "listStageScreens"];

/* ── 1. every action is church-scoped ────────────────────────────────────── */

for (const name of [...MUTATORS, ...READERS]) {
  const b = body(name);
  assert.ok(
    /churchId, user\.churchId/.test(b),
    `${name} must scope on user.churchId — without it another church's row is reachable`,
  );
  assert.ok(!/user\.churchId\s*=\s*/.test(b), `${name} must never reassign churchId`);
}

/* ── 2. mutators scope INSIDE the where clause, not just on insert ───────── */
// An update/delete that filters only on `id` would hit another church's row.

for (const name of ["updateStageLayout", "deleteStageLayout", "setStageScreenLayout", "renameStageScreen", "deleteStageScreen"]) {
  const b = body(name);
  assert.ok(
    /and\(eq\([a-zA-Z]+\.(id|layoutId), /.test(b) && /eq\([a-zA-Z]+\.churchId, user\.churchId\)\)/.test(b),
    `${name} must combine id AND churchId in its where clause`,
  );
}

/* ── 3. writes require the edit_library capability ───────────────────────── */

for (const name of MUTATORS) {
  assert.ok(/requireCap\("edit_library"\)/.test(body(name)),
    `${name} must be capability-gated — a volunteer must not reshape the stage screens`);
}

/* ── 4. reads are available to any signed-in role ────────────────────────── */
// The operator console needs to RENDER layouts regardless of role.
for (const name of READERS) {
  assert.ok(/requireUser\(\)/.test(body(name)), `${name} should use requireUser (any signed-in role may read)`);
}

/* ── 5. untrusted config is sanitised on WRITE, not just on read ─────────── */

for (const name of ["createStageLayout", "updateStageLayout"]) {
  assert.ok(/sanitizeStageLayout\(/.test(body(name)),
    `${name} must sanitize the config before it reaches the DB — a malformed layout must never reach a stage screen`);
}

/* ── 6. growth is bounded ────────────────────────────────────────────────── */

assert.ok(/MAX_STAGE_LAYOUTS/.test(body("createStageLayout")), "layout creation must be capped");
assert.ok(/MAX_STAGE_SCREENS/.test(body("createStageScreen")), "screen creation must be capped");

/* ── 7. deleting a layout must not leave a screen rendering blank ────────── */

const del = body("deleteStageLayout");
assert.ok(/update\(stageScreens\)/.test(del) && /layoutId: null/.test(del),
  "deleting a layout must clear it from any screen using it, so that screen falls back rather than going blank");

/* ── 8. the layout id accepted for a screen is bounded ───────────────────── */

assert.ok(/\[a-zA-Z0-9_-\]\{1,64\}/.test(body("setStageScreenLayout")),
  "setStageScreenLayout must validate the layout id charset/length");

console.log("stage-layout-scoping: all guards passed");
