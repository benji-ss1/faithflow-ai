/**
 * Theme config writes must not clobber each other (2026-09-22 audit).
 *
 * `updateTheme` replaces the WHOLE `config` jsonb from a snapshot the CLIENT
 * held, and there is no optimistic concurrency anywhere — no version, no etag,
 * no updatedAt compare. Three writers did read-modify-write from their own
 * snapshot, the worst being RightInspector.patchConfig, which fires on every
 * control change (including each keystroke in a colour/URL field). Two changes
 * made moments apart both built from the SAME render's config, so the second
 * silently undid the first's field.
 *
 * `patchThemeConfig` (actions.ts) now merges SERVER-side inside a transaction,
 * making a patch last-write-wins PER FIELD instead of per BLOB. This pins the
 * pure half of that, plus the wiring.
 *
 * Run: npx tsx test/theme-config-patch.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mergeThemeConfigPatch, sanitizeThemeConfig } from "../src/lib/theme-config";

let pass = 0, fail = 0;
const check = (n: string, fn: () => void) => { try { fn(); console.log(`  PASS  ${n}`); pass++; } catch (e) { console.error(`  FAIL  ${n}\n        ${(e as Error).message}`); fail++; } };
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

console.log("field-level merge:");
check("a patch changes ONLY its own keys", () => {
  const prev = { fontFamily: "Inter", bgColor: "#000000", fontSizePx: 90 };
  assert.deepEqual(mergeThemeConfigPatch(prev, { bgColor: "#112233" }),
    { fontFamily: "Inter", bgColor: "#112233", fontSizePx: 90 });
});
check("THE RACE: two concurrent patches each keep their own field", () => {
  // Both operators/controls read the same snapshot, then patch different fields.
  const stored = { fontFamily: "Inter", bgColor: "#000000" };
  const afterA = mergeThemeConfigPatch(stored, { bgColor: "#ff0000" });   // writer A lands first
  const afterB = mergeThemeConfigPatch(afterA, { fontFamily: "Georgia" }); // writer B lands second
  assert.equal(afterB.bgColor, "#ff0000", "writer B undid writer A's colour — the whole-blob bug is back");
  assert.equal(afterB.fontFamily, "Georgia");
});
check("undefined means LEAVE ALONE (not 'clear')", () => {
  const prev = { fontFamily: "Inter", bgColor: "#000000" };
  assert.deepEqual(mergeThemeConfigPatch(prev, { bgColor: undefined }), prev);
});
check("null means CLEAR the field", () => {
  const prev = { fontFamily: "Inter", bgColor: "#000000" };
  assert.deepEqual(mergeThemeConfigPatch(prev, { bgColor: null }), { fontFamily: "Inter" });
});
check("an empty patch is a no-op, and a missing prev/patch is safe", () => {
  const prev = { fontFamily: "Inter" };
  assert.deepEqual(mergeThemeConfigPatch(prev, {}), prev);
  assert.deepEqual(mergeThemeConfigPatch(null, { a: 1 }), { a: 1 });
  assert.deepEqual(mergeThemeConfigPatch(prev, null), prev);
  assert.deepEqual(mergeThemeConfigPatch(undefined, undefined), {});
});
check("it does not MUTATE the stored config it was given", () => {
  const prev = { fontFamily: "Inter", bgColor: "#000000" };
  const copy = { ...prev };
  mergeThemeConfigPatch(prev, { bgColor: "#fff", fontFamily: null });
  assert.deepEqual(prev, copy, "merge mutated its input");
});

console.log("\nthe patch still goes through the same gate as every other writer:");
check("a patch CANNOT smuggle an unknown key past THEME_ALLOWED_KEYS", () => {
  const merged = mergeThemeConfigPatch({ fontFamily: "Inter" }, { evilKey: "x" });
  const { config, rejected } = sanitizeThemeConfig(merged);
  assert.equal((config as Record<string, unknown>).evilKey, undefined);
  assert.ok(rejected.includes("evilKey"));
  assert.equal(config.fontFamily, "Inter", "the legitimate field was lost");
});
check("a patch CANNOT smuggle an out-of-range number onto the wire", () => {
  const merged = mergeThemeConfigPatch({}, { fontSizePx: 999999 });
  const { config } = sanitizeThemeConfig(merged);
  const n = config.fontSizePx;
  assert.ok(n === undefined || (typeof n === "number" && n < 999999), `unclamped: ${n}`);
});

console.log("\nwiring (the racing writers actually use it):");
check("patchThemeConfig runs in a transaction and locks the row", () => {
  const src = read("../src/lib/actions.ts");
  const fn = src.slice(src.indexOf("export async function patchThemeConfig"));
  assert.match(fn.slice(0, 2000), /db\.transaction\(/, "not transactional");
  assert.match(fn.slice(0, 2000), /\.for\("update"\)/, "row is not locked — two patches can still interleave");
  assert.match(fn.slice(0, 2000), /sanitizeThemeConfig\(merged\)/, "patch bypasses the sanitizer");
  assert.match(fn.slice(0, 2000), /eq\(themes\.churchId, user\.churchId\)/, "church scoping missing on a DB write");
});
check("RightInspector.patchConfig no longer sends the whole config", () => {
  const src = read("../src/components/operator/shell/RightInspector.tsx");
  const i = src.indexOf("const patchConfig");
  const body = src.slice(i, i + 900);
  assert.match(body, /patchThemeConfig\(current\.id, p\)/, "still sending a client-snapshot blob");
  assert.ok(!/updateTheme\(current\.id, \{ config: cfg \}\)/.test(body), "the whole-blob write survived");
});
check("theme-quick-apply's media set/clear patch fields, not the blob", () => {
  const src = read("../src/lib/theme-quick-apply.ts");
  assert.match(src, /patchThemeConfig\(target\.id, patch\)/, "setMediaOnActiveTheme still writes the blob");
  assert.match(src, /patchThemeConfig\(target\.id, \{ bgType: "solid"/, "clearActiveThemeBackground still writes the blob");
});
check("Undo still restores the EXACT prior snapshot (deliberately a blob write)", () => {
  const src = read("../src/lib/theme-quick-apply.ts");
  const i = src.indexOf("async function applyConfig");
  assert.match(src.slice(i, i + 400), /updateTheme\(target\.id, \{ config \}\)/,
    "applyConfig is the one-tap Undo — it must restore the whole snapshot, not merge");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
