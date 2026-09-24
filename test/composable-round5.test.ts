/**
 * Composable round 5 — themed songs keep their theme through add + edit + undo.
 *  🔴1 quick edit never takes the rewrite-all path for a themed song
 *  🔴2 a new slide on a themed song (blank "+ Add slide" AND the editor's Add)
 *      inherits the sibling's ROOT background; revert still works after adds
 *  🟡3 revert restores a NULL snapshot as exact NULL
 *  🟡4 mergeSavedSlideRoot drops stale bgType / bgColor2 on a bg change
 *  🟡5/6/7 source guards (generic create error, validated transition, row locks)
 *  🟡8 lower-third church layout: LOCKS current behaviour (awaiting decision)
 * Run: npx tsx test/composable-round5.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  },
  dispatchEvent: () => true,
};

import { inheritNewSlide, makeIdMapper, addNewSlideToThemeBackups, restoreNullIfEmpty, quickEditInPlace } from "../src/lib/slide-inherit";
import { mergeSavedSlideRoot } from "../src/lib/slide-objects";
import { bakeThemeIntoObjectsJson } from "../src/lib/theme-bake";
import { mergeThemeBackup, resetThemeOwnedFields } from "../src/lib/theme-rebake";
import { isValidTransitionSpec } from "../src/lib/broadcast";
import { applyChurchLayout, saveScriptureStyle, DEFAULT_SCRIPTURE_DESIGN } from "../src/components/operator/scripture/scriptureStyle";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; } catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).stack}`); fail++; }
}
let n = 0;
const fresh = () => `new-${++n}`;
const RED = { bgType: "solid" as const, bgColor: "#cc0000", transition: { effectId: "fade_in", durationMs: 400, easing: "ease", name: "Fade" } };
const TEXT = (id: string, text: string, color = "#ffffff") => ({ id, kind: "text", x: 0, y: 0, w: 1920, h: 1080, text, color });

console.log("🔴1 quick edit in place");
check("themed song: always in place — incl. NULL objectsJson and multi-box", () => {
  assert.equal(quickEditInPlace(true, null), true);
  assert.equal(quickEditInPlace(true, { objects: [] }), true);
  assert.equal(quickEditInPlace(true, { objects: [TEXT("a", "x"), TEXT("b", "y")] }), true);
});
check("unthemed: plain / blank / single text box in place; multi-box + media-only keep rewrite-all", () => {
  assert.equal(quickEditInPlace(false, null), true);
  assert.equal(quickEditInPlace(false, { bgColor: "#123456", bgExplicit: true, objects: [] }), true);
  assert.equal(quickEditInPlace(false, { objects: [TEXT("a", "x"), { id: "i", kind: "image" }] }), true);
  assert.equal(quickEditInPlace(false, { objects: [TEXT("a", "x"), TEXT("b", "y")] }), false);
  assert.equal(quickEditInPlace(false, { objects: [{ id: "i", kind: "image" }] }), false);
});
check("SongsBrowser routes through quickEditInPlace before the rewrite-all", () => {
  const src = readFileSync("src/components/operator/pro/center/SongsBrowser.tsx", "utf8");
  const i = src.indexOf("quickEditInPlace(songThemed, target.objectsJson)");
  assert.ok(i > 0);
  assert.ok(i < src.indexOf("await updateSongSlides(selected.id, next)"));
});

console.log("🔴2 new slides inherit the theme");
const themedBlank = bakeThemeIntoObjectsJson(RED, null);
check("themed song, blank sibling (objects: []) → new slide carries the whole root bg", () => {
  const r = inheritNewSlide({ sibling: themedBlank, initial: { objects: [], lyrics: "" }, themed: true, idFor: makeIdMapper(fresh) });
  assert.equal(r.objectsJson?.bgColor, "#cc0000");
  assert.equal(r.objectsJson?.bgType, "solid");
  assert.equal(r.objectsJson?.bgExplicit, true);
  assert.deepEqual(r.objectsJson?.transition, RED.transition);
  assert.deepEqual(r.objectsJson?.objects, []);
});
check("themed song, editor Add (own empty text box, no bg) → root bg copied, box kept", () => {
  const box = TEXT("ed1", "");
  const r = inheritNewSlide({ sibling: themedBlank, initial: { objects: [box], lyrics: "" }, themed: true, idFor: makeIdMapper(fresh) });
  assert.equal(r.objectsJson?.bgColor, "#cc0000");
  assert.equal(r.objectsJson?.bgType, "solid");
  assert.deepEqual(r.objectsJson?.objects, [box]);
});
check("caller-chosen background always wins", () => {
  const r = inheritNewSlide({ sibling: themedBlank, initial: { objects: [TEXT("e", "")], bgColor: "#00ff00" }, themed: true, idFor: makeIdMapper(fresh) });
  assert.equal(r.objectsJson?.bgColor, "#00ff00");
  assert.equal(r.objectsJson?.bgType, undefined);
});
check("UNTHEMED, non-explicit blank sibling → NULL exactly as before", () => {
  const r = inheritNewSlide({ sibling: { bgColor: "#000000", objects: [] }, initial: { objects: [], lyrics: "hi" }, themed: false, idFor: makeIdMapper(fresh) });
  assert.equal(r.objectsJson, null);
  assert.equal(r.lyrics, "hi");
  assert.equal(inheritNewSlide({ sibling: null, initial: { objects: [] }, themed: false, idFor: makeIdMapper(fresh) }).objectsJson, null);
});
check("UNTHEMED designed sibling → same shape as the 2026-09-06 inheritance", () => {
  const sib = { bgColor: "#222222", bgImageUrl: "https://cdn/x.png", objects: [TEXT("a", "old"), TEXT("b", "old2"), { id: "s", kind: "shape" }] };
  const r = inheritNewSlide({ sibling: sib, initial: { objects: [], lyrics: "New" }, themed: false, idFor: makeIdMapper(fresh) });
  assert.deepEqual(Object.keys(r.objectsJson!).sort(), ["bgColor", "bgImageUrl", "objects"]);
  const objs = r.objectsJson!.objects as Array<Record<string, unknown>>;
  assert.equal(objs[0].text, "New"); assert.equal(objs[1].text, ""); assert.equal(objs[2].kind, "shape");
  assert.notEqual(objs[0].id, "a");
  assert.equal(r.lyrics, "New");
});
check("unthemed sibling with a CHOSEN bg (bgExplicit) and objects: [] → bg copied", () => {
  const r = inheritNewSlide({ sibling: { bgColor: "#000000", bgExplicit: true, objects: [] }, initial: { objects: [] }, themed: false, idFor: makeIdMapper(fresh) });
  assert.equal(r.objectsJson?.bgColor, "#000000");
  assert.equal(r.objectsJson?.bgExplicit, true);
});

check("apply → add slide → revert: the new slide goes back to the unthemed default (NULL)", () => {
  // pre-apply: one plain lyric slide (NULL).
  const settings0 = {};
  const backup = mergeThemeBackup(undefined, [{ id: "s1", objectsJson: null }], "t1");
  const settings = { ...settings0, appliedThemeId: "t1", themeBackup: backup, slideThemeBackups: {} };
  const idFor = makeIdMapper(fresh);
  const built = inheritNewSlide({ sibling: themedBlank, initial: { objects: [], lyrics: "" }, themed: true, idFor });
  const next = addNewSlideToThemeBackups({ settings, siblingId: "s1", newSlideId: "s2", newSlideObjectsJson: built.objectsJson, initial: { objects: [], lyrics: "" }, idFor })!;
  const entry = (next.themeBackup as { slides: { id: string; objectsJson: unknown }[] }).slides.find((e) => e.id === "s2")!;
  assert.equal(entry.objectsJson, null);
  // revertSongTheme's per-slide restore
  const restored = restoreNullIfEmpty(resetThemeOwnedFields(built.objectsJson, entry.objectsJson), entry.objectsJson);
  assert.equal(restored, null);
  const restored1 = restoreNullIfEmpty(resetThemeOwnedFields(themedBlank, null), null);
  assert.equal(restored1, null);
});
check("apply → editor Add (text box) → revert: box kept, theme bg + colour removed", () => {
  const pre = { objects: [TEXT("t", "Verse", "#ffffff")] };
  const baked = bakeThemeIntoObjectsJson({ ...RED, textColor: "#ffee00" }, pre);
  const settings = { appliedThemeId: "t1", themeBackup: mergeThemeBackup(undefined, [{ id: "s1", objectsJson: pre }], "t1") };
  const idFor = makeIdMapper(fresh);
  const box = TEXT("ed", "", "#ffffff");
  const built = inheritNewSlide({ sibling: baked, initial: { objects: [box] }, themed: true, idFor });
  const next = addNewSlideToThemeBackups({ settings, siblingId: "s1", newSlideId: "s2", newSlideObjectsJson: built.objectsJson, initial: { objects: [box] }, idFor })!;
  const entry = (next.themeBackup as { slides: { id: string; objectsJson: unknown }[] }).slides.find((e) => e.id === "s2")!;
  const restored = restoreNullIfEmpty(resetThemeOwnedFields(built.objectsJson, entry.objectsJson), entry.objectsJson)!;
  assert.equal(restored.bgColor, undefined); assert.equal(restored.bgType, undefined); assert.equal(restored.bgExplicit, undefined);
  assert.deepEqual(restored.objects, [box]);
});
check("apply → blank Add cloning a DESIGNED sibling → revert restores the clone's pre-theme text colour", () => {
  const pre = { objects: [TEXT("t", "Verse", "#ffffff")] };
  const baked = bakeThemeIntoObjectsJson({ ...RED, textColor: "#ffee00" }, pre);
  assert.equal((baked.objects as Array<Record<string, unknown>>)[0].color, "#ffee00");
  const settings = { appliedThemeId: "t1", themeBackup: mergeThemeBackup(undefined, [{ id: "s1", objectsJson: pre }], "t1") };
  const idFor = makeIdMapper(fresh);
  const built = inheritNewSlide({ sibling: baked, initial: { objects: [], lyrics: "" }, themed: true, idFor });
  const next = addNewSlideToThemeBackups({ settings, siblingId: "s1", newSlideId: "s2", newSlideObjectsJson: built.objectsJson, initial: { objects: [], lyrics: "" }, idFor })!;
  const entry = (next.themeBackup as { slides: { id: string; objectsJson: unknown }[] }).slides.find((e) => e.id === "s2")!;
  const restored = restoreNullIfEmpty(resetThemeOwnedFields(built.objectsJson, entry.objectsJson), entry.objectsJson)!;
  assert.equal((restored.objects as Array<Record<string, unknown>>)[0].color, "#ffffff");
  assert.equal(restored.bgColor, undefined);
});
check("unthemed song with no per-slide override → settings untouched", () => {
  assert.equal(addNewSlideToThemeBackups({ settings: {}, siblingId: "s1", newSlideId: "s2", newSlideObjectsJson: null, idFor: makeIdMapper(fresh) }), null);
});
check("per-slide override sibling → new slide gets its own override snapshot", () => {
  const settings = { slideThemeBackups: { s1: { objectsJson: null, themeId: "t9", bakedConfigs: [{ bgColor: "#cc0000" }] } } };
  const next = addNewSlideToThemeBackups({ settings, siblingId: "s1", newSlideId: "s2", newSlideObjectsJson: themedBlank, idFor: makeIdMapper(fresh) })!;
  const per = next.slideThemeBackups as Record<string, Record<string, unknown>>;
  assert.equal(per.s2.themeId, "t9"); assert.equal(per.s2.objectsJson, null);
});

console.log("🟡3 revert NULL");
check("restoreNullIfEmpty keeps real content", () => {
  assert.deepEqual(restoreNullIfEmpty({ objects: [TEXT("a", "x")] }, null), { objects: [TEXT("a", "x")] });
  assert.deepEqual(restoreNullIfEmpty({ objects: [] }, { objects: [] }), { objects: [] });
  assert.equal(restoreNullIfEmpty({ objects: [], bgColor: undefined }, null), null);
});
check("writeSongSlideObjects writes SQL NULL for a null objectsJson", () => {
  const src = readFileSync("src/lib/actions.ts", "utf8");
  assert.ok(src.includes("sql`(${r.id}::uuid, NULL::jsonb)`"));
  assert.ok(src.includes("restoreNullIfEmpty(resetThemeOwnedFields(cur.objectsJson, b.objectsJson), b.objectsJson)"));
});

console.log("🟡4 mergeSavedSlideRoot stale bg keys");
check("new bgColor drops stale bgType / bgColor2", () => {
  const out = mergeSavedSlideRoot({ bgType: "gradient", bgColor: "#111111", bgColor2: "#222222", objects: [] }, { bgColor: "#00ff00", objects: [] });
  assert.equal(out.bgType, undefined); assert.equal(out.bgColor2, undefined); assert.equal(out.bgColor, "#00ff00");
});
check("new bgImageUrl / new bgExplicit also drop them", () => {
  const a = mergeSavedSlideRoot({ bgType: "solid", bgColor: "#111111", objects: [] }, { bgColor: "#111111", bgImageUrl: "https://cdn/y.png", objects: [] });
  assert.equal(a.bgType, undefined);
  const b = mergeSavedSlideRoot({ bgType: "solid", bgColor: "#111111", objects: [] }, { bgColor: "#111111", bgExplicit: true, objects: [] });
  assert.equal(b.bgType, undefined);
});
check("UNCHANGED bg (editor echo) keeps bgType / bgColor2 — round-4 fix intact", () => {
  const out = mergeSavedSlideRoot({ bgType: "gradient", bgColor: "#111111", bgColor2: "#222222", bgExplicit: true, objects: [] }, { bgColor: "#111111", bgExplicit: true, objects: [] });
  assert.equal(out.bgType, "gradient"); assert.equal(out.bgColor2, "#222222");
});
check("all bg cleared → no leftover {bgType:'solid'}", () => {
  const out = mergeSavedSlideRoot({ bgType: "solid", objects: [] }, { objects: [] });
  assert.equal("bgType" in out, false);
  const out2 = mergeSavedSlideRoot({ bgType: "solid", bgColor: "#cc0000", bgExplicit: true, objects: [] }, { objects: [] });
  assert.equal("bgType" in out2, false);
});

console.log("🟡5/6/7 server guards");
const actions = readFileSync("src/lib/actions.ts", "utf8");
check("createSong: generic error, sentinel for theme, server log", () => {
  const body = actions.slice(actions.indexOf("export async function createSong("), actions.indexOf("export async function listServicePlanChoices"));
  assert.ok(body.includes("throw new ThemeNotAppliedError()"));
  assert.ok(body.includes('"Create failed — please try again"'));
  assert.ok(body.includes('console.error("[createSong]"'));
  assert.ok(!/error: e instanceof Error \? e\.message/.test(body), "raw error text never returned");
});
check("saveSlideObjects: transition gated by isValidTransitionSpec; both edits row-lock", () => {
  const save = actions.slice(actions.indexOf("export async function saveSlideObjects("), actions.indexOf("export async function updateSongSlideText("));
  assert.ok(save.includes("isValidTransitionSpec(editable.transition)"));
  assert.ok(save.includes('.for("update")') && save.includes("db.transaction"));
  const upd = actions.slice(actions.indexOf("export async function updateSongSlideText("), actions.indexOf("export async function createSongSlide("));
  assert.ok(upd.includes('.for("update")') && upd.includes("db.transaction"));
  assert.ok(!upd.includes("from(songs)"), "no song lock taken (no lock-order inversion)");
  const create = actions.slice(actions.indexOf("export async function createSongSlide("), actions.indexOf("export async function deleteSongSlide("));
  assert.ok(create.indexOf('.for("update")') < create.indexOf("tx.select({ id: songSlides.id"), "song locked before slides");
});
check("isValidTransitionSpec: editor-style garbage is rejected, a real spec accepted", () => {
  assert.equal(isValidTransitionSpec({ effectId: "fade_in", durationMs: 400, easing: "ease", name: "Fade" }), true);
  assert.equal(isValidTransitionSpec({ effectId: "evil", durationMs: 99999, easing: "x" }), false);
  assert.equal(isValidTransitionSpec("nope"), false);
});

console.log("🟡8 lower-third church layout (LOCKED current behaviour — awaiting user decision)");
check("themed song slide under a lowerThird church layout becomes the plain band (theme bg NOT carried)", () => {
  saveScriptureStyle("c1", { ...DEFAULT_SCRIPTURE_DESIGN, layout: "lowerThird" });
  const out = applyChurchLayout({ kind: "text", text: "Way maker", bgColor: "#cc0000", bgExplicit: true } as never, "c1") as Record<string, unknown>;
  assert.equal(out.scriptureLayout, "lowerThird");
  assert.equal(out.bgColor, undefined, "current behaviour: band payload drops the song's theme colour");
  assert.equal(out.bgExplicit, undefined);
  saveScriptureStyle("c1", { ...DEFAULT_SCRIPTURE_DESIGN, layout: "fullscreen" });
  const full = applyChurchLayout({ kind: "text", text: "Way maker", bgColor: "#cc0000", bgExplicit: true } as never, "c1") as Record<string, unknown>;
  assert.equal(full.bgColor, "#cc0000", "fullscreen church layout keeps the theme colour");
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
