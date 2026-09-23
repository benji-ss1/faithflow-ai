/**
 * Church defaults (2026-09-23) — cross-church + capability adversarial test.
 * Church A must never be able to make church B's theme (or a translation not
 * available to A) its default, and only admins may change church defaults.
 * Run: npx tsx test/adversarial/church-defaults-scope.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyChurchDefaults } from "../../src/lib/church-defaults";
import { hasCap } from "../../src/lib/session";

let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };

const A = "church-a", B = "church-b";
const THEME_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const THEME_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const KJV = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NIV_B_ONLY = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

// Fake church-scoped DB: themes owned per church; NIV unlocked only for B.
const themeOwner: Record<string, string> = { [THEME_A]: A, [THEME_B]: B };
const translationAccess: Record<string, Set<string>> = { [KJV]: new Set([A, B]), [NIV_B_ONLY]: new Set([B]) };
const state = { mainTheme: { [A]: THEME_A, [B]: THEME_B } as Record<string, string>, translation: {} as Record<string, string | null> };
const deps = {
  translationAccessible: async (c: string, id: string) => translationAccess[id]?.has(c) ?? false,
  themeBelongs: async (c: string, id: string) => themeOwner[id] === c,
  writeTranslation: async (c: string, id: string | null) => { state.translation[c] = id; },
  writeMainTheme: async (c: string, id: string) => { state.mainTheme[c] = id; },
  writeBackground: async () => true,
};

(async () => {
  const r1 = await applyChurchDefaults(A, { mainThemeId: THEME_B }, deps);
  ok(!r1.ok, "A cannot star B's theme");
  ok(state.mainTheme[A] === THEME_A && state.mainTheme[B] === THEME_B, "no theme default changed for either church");

  const r2 = await applyChurchDefaults(A, { translationId: NIV_B_ONLY }, deps);
  ok(!r2.ok && state.translation[A] === undefined, "A cannot default to a translation only B can use");

  const r3 = await applyChurchDefaults(A, { translationId: KJV, mainThemeId: THEME_B }, deps);
  ok(!r3.ok && state.translation[A] === undefined, "mixed valid+foreign input writes NOTHING");

  const r4 = await applyChurchDefaults(A, { translationId: KJV, mainThemeId: THEME_A }, deps);
  ok(r4.ok && state.translation[A] === KJV && state.mainTheme[A] === THEME_A && state.translation[B] === undefined, "own values succeed, B untouched");

  // Capability: only admins hold manage_church.
  ok(hasCap("admin", "manage_church"), "admin may set defaults");
  for (const role of ["operator", "volunteer", "pastor", "viewer", "unknown"]) ok(!hasCap(role, "manage_church"), `${role} may not`);

  // Source guards on the real server action + helpers.
  const actions = readFileSync("src/lib/actions.ts", "utf8");
  const fn = actions.slice(actions.indexOf("export async function setChurchDefaults"), actions.indexOf("export async function setChurchDefaults") + 1200);
  ok(/hasCap\(user\.role, "manage_church"\)/.test(fn), "setChurchDefaults gates on manage_church");
  ok(/applyChurchDefaults\(user\.churchId,/.test(fn), "setChurchDefaults scopes to the SESSION church (never input)");
  const upd = actions.slice(actions.indexOf("export async function updatePreferences"), actions.indexOf("export async function updatePreferences") + 2600);
  ok(/manage_church/.test(upd) && /translationAccessibleToChurch/.test(upd), "updatePreferences gates + validates a translation CHANGE");
  const srv = readFileSync("src/lib/server/church-defaults.ts", "utf8");
  ok(/eq\(themes\.id, themeId\), eq\(themes\.churchId, churchId\)/.test(srv), "theme ownership check is church-scoped");
  ok(/eq\(themes\.churchId, churchId\), eq\(themes\.isDefault, true\)/.test(srv), "clearing the old star is church-scoped");
  ok(/WHERE church_id = \$\{churchId\}/.test(srv), "background write is church-scoped");
  // Live apply must not write the church default any more.
  const client = readFileSync("src/lib/theme-apply-client.ts", "utf8");
  ok(!/fetch\(`\/api\/themes\/\$\{t\.id\}\/apply`/.test(client), "applyThemeLive no longer POSTs the default-writing route");
  const quick = readFileSync("src/lib/theme-quick-apply.ts", "utf8");
  const sw = quick.slice(quick.indexOf("export async function switchToTheme"), quick.indexOf("export async function setMainTheme"));
  ok(!/setDefaultTheme/.test(sw), "switchToTheme is live-only");

  console.log(`church-defaults-scope: ${n} assertions passed`);
})().catch((e) => { console.error(e); process.exit(1); });
