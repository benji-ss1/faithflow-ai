/**
 * Style-lock backfill planner (2026-09-23). Run: npx tsx test/style-lock-backfill.test.ts
 * Fixtures use the REAL stored shape { bgColor, bgImageUrl, bgExplicit?, objects:[...] }.
 */
import assert from "node:assert/strict";
import { planLock, planUnlock, targetSlideIds, handStyledTextId, BACKFILL_KEY, type BackfillSong } from "../src/lib/style-lock-backfill";
import { bakeThemeIntoObjectsJson } from "../src/lib/theme-bake";

let n = 0; const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const txt = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: "text", text: "x", x: 80, y: 400, w: 1760, h: 280, fontFamily: "Inter", fontSize: 96, fontWeight: 600, color: "#ffffff", align: "center", ...extra });
const shape = { id: "s", kind: "shape", shape: "rect" };
const oj = (objects: unknown[], extra: Record<string, unknown> = {}) => ({ bgColor: "#000000", bgImageUrl: undefined, ...extra, objects });
const objsOf = (j: unknown) => (j as { objects: Record<string, unknown>[] }).objects;
const song = (settings: Record<string, unknown>, slides: { id: string; objectsJson: unknown }[] = [
  { id: "a", objectsJson: oj([txt("t1"), shape]) },
  { id: "b", objectsJson: oj([txt("t2", { styleLocked: true })]) },
  { id: "c", objectsJson: null },
]): BackfillSong => ({ id: "song1", churchId: "ch1", settings, slides });

// ── Theme markers (rule a) ──
ok(targetSlideIds(song({ appliedThemeId: "th" })).join() === "a,b,c", "whole-song apply → all slides");
ok(targetSlideIds(song({ themeBackup: {} })).join() === "a,b,c", "themeBackup → all slides");
ok(targetSlideIds(song({ slideThemeBackups: { a: {}, zz: {} } })).join() === "a", "per-slide: only existing own ids");
ok(targetSlideIds(song({})).length === 0, "untouched song → no marked slides");

const p = planLock(song({ appliedThemeId: "th" }), "T")!;
ok(p.slideUpdates.length === 1 && p.slideUpdates[0].id === "a", "only slides that CHANGE are written (b already locked, c legacy)");
const aObjs = objsOf(p.slideUpdates[0].objectsJson);
ok(aObjs[0].styleLocked === true, "text gets styleLocked (real {objects} shape)");
ok(!("styleLocked" in aObjs[1]), "shape untouched");
ok((p.slideUpdates[0].objectsJson as Record<string, unknown>).bgColor === "#000000", "wrapper fields preserved");
ok(JSON.stringify(p.settings[BACKFILL_KEY]) === JSON.stringify({ at: "T", locked: { a: ["t1"] } }), "records exactly the locked OBJECT ids");
ok(p.settings.appliedThemeId === "th", "existing settings preserved");

// Real pre-branch bake output (styleLocked stripped = what prod holds today).
const baked = bakeThemeIntoObjectsJson({ textColor: "#fde68a", bgColor: "#1e1b4b", fontFamily: "Montserrat" } as never, oj([txt("tb")]));
const prodBaked = { ...baked, objects: objsOf(baked).map(({ styleLocked: _s, ...r }) => { void _s; return r; }) };
const pb = planLock(song({ appliedThemeId: "th" }, [{ id: "z", objectsJson: prodBaked }]), "T")!;
ok(pb && pb.slideUpdates.length === 1 && objsOf(pb.slideUpdates[0].objectsJson)[0].styleLocked === true, "real bake output is locked (dry-run non-zero)");

// Bare array tolerated.
const arr = planLock(song({ appliedThemeId: "th" }, [{ id: "q", objectsJson: [txt("tq")] }]), "T")!;
ok(Array.isArray(arr.slideUpdates[0].objectsJson), "bare array tolerated + kept as array");

// ── Hand-styled slides, no theme marker (rule b) ──
ok(handStyledTextId(oj([txt("h", { color: "#FFD700" })])) === "h", "recoloured → styled");
ok(handStyledTextId(oj([txt("h", { fontFamily: "Montserrat" })])) === "h", "refonted → styled");
ok(handStyledTextId(oj([txt("h", { fontWeight: 800 })])) === "h", "weight → styled");
ok(handStyledTextId(oj([txt("h", { align: "left" })])) === "h", "align → styled");
ok(handStyledTextId(oj([txt("h")], { bgExplicit: true })) === "h", "bgExplicit → styled");
ok(handStyledTextId(oj([txt("h")], { bgColor: "#3b0764" })) === "h", "pre-bgExplicit hand-picked bg colour → styled");
ok(handStyledTextId(oj([txt("h")], { bgColor: "#010101" })) === null, "#010101 legacy sentinel alone → not styled");
ok(handStyledTextId(oj([txt("h", { fontSize: 140, lineHeight: 1.3 })])) === null, "size/lineHeight only → NOT styled (AutoFit owns size)");
ok(handStyledTextId(oj([txt("h", { color: "#FFFFFF" })])) === null, "case-insensitive default colour");
ok(handStyledTextId(oj([{ id: "h", kind: "text", text: "x" }])) === null, "unset style keys → default");
ok(handStyledTextId(oj([txt("h", { color: "#f00" }), txt("i")])) === null, "two text objects → not a plain lyric slide");
ok(handStyledTextId(oj([txt("h", { color: "#f00" }), { ...shape, hidden: true }])) === "h", "hidden objects ignored");
ok(handStyledTextId(null) === null, "legacy lyrics-only → never");

const hs = song({}, [
  { id: "a", objectsJson: oj([txt("t1", { color: "#FFD700", fontFamily: "Montserrat" })]) }, // Way Maker gold
  { id: "b", objectsJson: oj([txt("t2")]) },
  { id: "c", objectsJson: null },
]);
const hp = planLock(hs, "T")!;
ok(hp && hp.slideUpdates.length === 1 && hp.slideUpdates[0].id === "a", "hand-styled song without markers is locked (only styled slide)");
ok(JSON.stringify(hp.settings[BACKFILL_KEY]) === JSON.stringify({ at: "T", locked: { a: ["t1"] } }), "hand-styled lock recorded");
ok(planLock(song({}, [{ id: "b", objectsJson: oj([txt("t2")]) }]), "T") === null, "default-styled song → no plan");

// ── Idempotent + re-runnable ──
const after = { ...hs, settings: hp.settings, slides: hs.slides.map((s) => hp.slideUpdates.find((u) => u.id === s.id) ?? s) };
ok(planLock(after, "T2") === null, "re-run changes nothing → no plan");
const later = { ...after, slides: [...after.slides, { id: "d", objectsJson: oj([txt("t4", { color: "#00ff00" })]) }] };
const lp = planLock(later, "T3")!;
ok(lp.slideUpdates.length === 1 && lp.slideUpdates[0].id === "d", "re-run after deploy picks up only new unlocked styled slides");
ok(JSON.stringify((lp.settings[BACKFILL_KEY] as Record<string, unknown>).locked) === JSON.stringify({ a: ["t1"], d: ["t4"] }), "record merged");
ok((lp.settings[BACKFILL_KEY] as Record<string, unknown>).at === "T", "original run time kept");

// ── Rollback is EXACT ──
const mixed = song({ appliedThemeId: "th" }, [
  { id: "a", objectsJson: oj([txt("A", { styleLocked: true }), txt("B")]) },
]);
const mp = planLock(mixed, "T")!;
ok(JSON.stringify((mp.settings[BACKFILL_KEY] as Record<string, unknown>).locked) === JSON.stringify({ a: ["B"] }), "only newly-locked B recorded");
const mixedAfter = { ...mixed, settings: mp.settings, slides: [{ id: "a", objectsJson: mp.slideUpdates[0].objectsJson }] };
const r = planUnlock(mixedAfter)!;
ok(JSON.stringify(r.slideUpdates[0].objectsJson) === JSON.stringify(mixed.slides[0].objectsJson), "rollback restores slide EXACTLY (pre-existing lock on A kept)");
ok(!(BACKFILL_KEY in r.settings) && r.settings.appliedThemeId === "th", "key deleted, rest kept");
ok(JSON.stringify(r.settings) === JSON.stringify(mixed.settings), "settings restored exactly");

// A lock the operator added AFTER the backfill (different object) survives rollback.
const opLocked = { ...mixedAfter, slides: [{ id: "a", objectsJson: oj([txt("A", { styleLocked: true }), txt("B", { styleLocked: true }), txt("C", { styleLocked: true })]) }] };
const r2 = planUnlock(opLocked)!;
const r2o = objsOf(r2.slideUpdates[0].objectsJson);
ok(r2o[0].styleLocked === true && !("styleLocked" in r2o[1]) && r2o[2].styleLocked === true, "rollback removes ONLY recorded objects");
ok(planUnlock(song({ appliedThemeId: "th" })) === null, "rollback idempotent without key");
// ── 2026-09-24: normalised defaults ──
ok(handStyledTextId(oj([txt("t", { color: "#fff" })])) === null, "#fff is default");
ok(handStyledTextId(oj([txt("t", { color: "white" })])) === null, "white is default");
ok(handStyledTextId(oj([txt("t", { fontWeight: "600" })])) === null, "\"600\" is default");
ok(handStyledTextId(oj([txt("t", { fontWeight: "800" })])) === "t", "\"800\" is styled");

// ── 2026-09-24: theme-backup snapshots get locked + recorded, rollback exact ──
{
  const yellow = oj([txt("t1", { color: "#FFFF00" })]);
  const plain = oj([txt("t9")]);
  const s0 = song({ appliedThemeId: "th", themeBackup: { themeId: "th", slides: [{ id: "a", objectsJson: yellow }, { id: "z", objectsJson: plain }] }, slideThemeBackups: { b: { themeId: "x", objectsJson: oj([txt("t2", { bgExplicit: true })], { bgExplicit: true }) } } });
  const p = planLock(s0, "2026-09-24T00:00:00Z")!;
  const tb = (p.settings.themeBackup as any).slides;
  ok(objsOf(tb[0].objectsJson)[0].styleLocked === true, "hand-styled themeBackup snapshot locked");
  ok(!("styleLocked" in objsOf(tb[1].objectsJson)[0]), "plain snapshot untouched");
  ok(objsOf((p.settings.slideThemeBackups as any).b.objectsJson)[0].styleLocked === true, "hand-styled per-slide snapshot locked");
  const rec = (p.settings[BACKFILL_KEY] as any).backupLocked;
  ok(rec["themeBackup:a"].join() === "t1" && rec["slideThemeBackups:b"].join() === "t2", "backup locks recorded");
  const again = planLock({ ...s0, settings: p.settings, slides: s0.slides.map((sl) => p.slideUpdates.find((u) => u.id === sl.id) ?? sl) }, "later");
  ok(again === null, "re-run idempotent incl. backups");
  const rb = planUnlock({ ...s0, settings: p.settings })!;
  ok(!("styleLocked" in objsOf((rb.settings.themeBackup as any).slides[0].objectsJson)[0]), "rollback unlocks themeBackup snapshot");
  ok(!("styleLocked" in objsOf((rb.settings.slideThemeBackups as any).b.objectsJson)[0]), "rollback unlocks per-slide snapshot");
  ok(JSON.stringify(rb.settings.themeBackup) === JSON.stringify(s0.settings!.themeBackup), "rollback restores backup exactly");
  const onlyBackup = planLock(song({ themeBackup: { slides: [{ id: "q", objectsJson: yellow }] } }, []), "t");
  ok(onlyBackup !== null && onlyBackup.slideUpdates.length === 0, "backup-only change still produces a plan");
}
console.log(`style-lock-backfill: ${n} assertions passed`);
