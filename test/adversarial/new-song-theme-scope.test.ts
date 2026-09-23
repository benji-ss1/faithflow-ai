/**
 * New-song dialog (plan A.6) — a theme / library id from ANOTHER church can
 * never be attached to a new song. createSong resolves the options through
 * `resolveNewSongOptions` with church-scoped lookups BEFORE inserting, so a
 * forged foreign themeId refuses the whole create (no orphan song row).
 *
 * Run: npx tsx test/adversarial/new-song-theme-scope.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveNewSongOptions } from "../../src/lib/new-song-options";

const A_THEME = "11111111-1111-4111-8111-111111111111";
const B_THEME = "22222222-2222-4222-8222-222222222222"; // church B's
const A_LIB = "33333333-3333-4333-8333-333333333333";
const B_LIB = "44444444-4444-4444-8444-444444444444";

// Lookups as church A sees the DB (church-scoped: B's rows are simply absent).
const lookupsA = {
  themeInChurch: async (id: string) => id === A_THEME,
  libraryError: async (id: string) => (id === A_LIB ? null : "Library not found in your church"),
};

async function main() {
  let r = await resolveNewSongOptions({ themeId: B_THEME }, lookupsA);
  assert.equal(r.ok, false, "foreign church theme id is rejected");
  r = await resolveNewSongOptions({ themeId: B_THEME, libraryId: A_LIB }, lookupsA);
  assert.equal(r.ok, false, "foreign theme rejects even with a valid library");
  r = await resolveNewSongOptions({ libraryId: B_LIB }, lookupsA);
  assert.equal(r.ok, false, "foreign library rejected");
  for (const bad of ["builtin:classic", "not-a-uuid", "'; drop table songs;--", 42, {}]) {
    r = await resolveNewSongOptions({ themeId: bad }, lookupsA);
    assert.equal(r.ok, false, `malformed themeId ${String(bad)} rejected`);
  }
  // A throwing lookup fails closed.
  r = await resolveNewSongOptions({ themeId: A_THEME }, { ...lookupsA, themeInChurch: async () => { throw new Error("db down"); } });
  assert.equal(r.ok, false, "lookup error fails closed");
  // Own church: accepted; absent / sentinel ⇒ no theme (previous behaviour).
  r = await resolveNewSongOptions({ themeId: A_THEME, libraryId: A_LIB }, lookupsA);
  assert.deepEqual(r, { ok: true, data: { themeId: A_THEME, libraryId: A_LIB } });
  for (const none of [undefined, null, "", "none"]) {
    r = await resolveNewSongOptions({ themeId: none, libraryId: none === "none" ? "default" : none }, lookupsA);
    assert.deepEqual(r, { ok: true, data: { themeId: null, libraryId: null } }, `sentinel ${String(none)} ⇒ transparent/default`);
  }

  // Wiring: createSong validates BEFORE the insert with church-scoped queries,
  // and the later theme bake stays the church-scoped applyThemeToSong.
  const src = readFileSync("src/lib/actions.ts", "utf8");
  const fn = src.slice(src.indexOf("export async function createSong("), src.indexOf("export async function listServicePlanChoices("));
  const iResolve = fn.indexOf("resolveNewSongOptions(");
  const iInsert = fn.indexOf("db.insert(songs)");
  assert.ok(iResolve > 0 && iInsert > iResolve, "options resolved before the insert");
  assert.match(fn, /if \(!opts\.ok\) return opts;/, "refusal returns before insert");
  assert.match(fn, /eq\(themes\.churchId, user\.churchId\)/, "theme lookup is church-scoped");
  assert.match(fn, /libraryMoveError\(db, user\.churchId, id\)/, "library lookup is church-scoped");
  const plans = src.slice(src.indexOf("export async function listServicePlanChoices("));
  assert.match(plans.slice(0, 900), /eq\(servicePlans\.churchId, user\.churchId\)/, "playlist choices church-scoped");
  const apply = src.slice(src.indexOf("export async function applyThemeToSong("), src.indexOf("export async function applyThemeToSong(") + 700);
  assert.match(apply, /eq\(themes\.churchId, user\.churchId\)/, "applyThemeToSong still church-scoped");
  console.log("new-song-theme-scope: all passed");
}
main().catch((e) => { console.error(e); process.exit(1); });
