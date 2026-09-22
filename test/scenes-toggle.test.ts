// Run: npx tsx test/scenes-toggle.test.ts
//
// Scenes opt-in toggle (2026-09-21, user-directed).
//
// Scenes shipped complete but DARK: church_preferences.scenes_enabled defaults
// to false and there was no operator-facing way to turn it on, so the Scene
// Builder — and therefore per-screen TIMER routing — was unreachable for every
// church. This adds the toggle beside Layers in the operator Settings window.
//
// Source-level guards (rule 0): the toggle must exist, must be admin-gated
// server-side, and must NEVER be writable through the general settings save.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const actions = read("../src/lib/actions.ts");
const win = read("../src/components/operator/settings/SettingsWindow.tsx");
const schema = read("../src/lib/db/schema.ts");

/* ── 1. the toggle is reachable in the operator's Settings ───────────────── */

assert.ok(/function ScenesRow\(/.test(win), "SettingsWindow must define a ScenesRow");
assert.ok(/<ScenesRow \/>/.test(win), "ScenesRow must actually be RENDERED, not just defined");
assert.ok(/<LayersRow \/>[\s\S]{0,80}<ScenesRow \/>/.test(win),
  "Scenes should sit beside Layers — the two rollout toggles belong together");
assert.ok(/getScenesSetting/.test(win) && /setScenesEnabled/.test(win),
  "the row must read AND write the setting");
assert.ok(/section: "screens", label: "Scenes/.test(win),
  "the toggle must be findable via settings search, like Layers");

/* ── 2. server-side: admin-gated, church-scoped, no redirect ─────────────── */

const fn = actions.split("export async function setScenesEnabled")[1]?.split("\nexport ")[0] ?? "";
assert.ok(fn.length > 0, "setScenesEnabled must exist");
assert.ok(/user\.role !== "admin"/.test(fn), "only a church admin may flip Scenes");
assert.ok(/return \{ ok: false/.test(fn),
  "must RETURN an error, never redirect — a redirect from the live console would navigate away mid-service");
assert.ok(/typeof enabled !== "boolean"/.test(fn), "must validate the input type");
assert.ok(/churchPreferences\.churchId, user\.churchId/.test(fn),
  "every read/write must be church-scoped (rule 5)");
assert.ok(/onConflictDoUpdate/.test(fn),
  "insert must upsert on church_id so a double-click with no prefs row can't hit the unique constraint");

const getter = actions.split("export async function getScenesSetting")[1]?.split("\nexport ")[0]
  ?? actions.split("export async function getScenesSetting")[1] ?? "";
assert.ok(/scenesEnabled \?\? false/.test(getter),
  "reading must default to FALSE, matching the schema — never imply a church opted in");
assert.ok(/canEdit: user\.role === "admin"/.test(getter), "the getter must report edit rights");

/* ── 3. the general settings save must NEVER flip this flag ──────────────── */

const upd = actions.split("export async function updatePreferences")[1]?.split("\nexport ")[0] ?? "";
assert.ok(upd.length > 0, "updatePreferences must exist");
assert.ok(!/patch\.scenesEnabled/.test(upd),
  "updatePreferences must NOT write scenesEnabled — it is admin-only via its dedicated action");
assert.ok(!/patch\.layersV2/.test(upd), "the same must remain true of layersV2");
assert.ok(!/\.\.\.data/.test(upd),
  "updatePreferences must never spread raw client input into the DB write");

/* ── 4. the schema default stays OFF ─────────────────────────────────────── */

assert.ok(/scenesEnabled: boolean\("scenes_enabled"\)\.notNull\(\)\.default\(false\)/.test(schema),
  "scenes_enabled must still default to false — turning it on is a deliberate per-church act");

console.log("scenes-toggle: all guards passed");
