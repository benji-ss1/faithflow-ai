/**
 * Style-lock backfill planner (2026-09-23). Run: npx tsx test/style-lock-backfill.test.ts
 */
import assert from "node:assert/strict";
import { planLock, planUnlock, targetSlideIds, BACKFILL_KEY, type BackfillSong } from "../src/lib/style-lock-backfill";

let n = 0; const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const txt = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: "text", text: "x", ...extra });
const shape = { id: "s", kind: "shape" };
const song = (settings: Record<string, unknown>, slides = [
  { id: "a", objectsJson: [txt("t1"), shape] },
  { id: "b", objectsJson: [txt("t2", { styleLocked: true })] },
  { id: "c", objectsJson: null },
]): BackfillSong => ({ id: "song1", churchId: "ch1", settings, slides });

ok(targetSlideIds(song({ appliedThemeId: "th" })).join() === "a,b,c", "whole-song apply → all slides");
ok(targetSlideIds(song({ themeBackup: {} })).join() === "a,b,c", "themeBackup → all slides");
ok(targetSlideIds(song({ slideThemeBackups: { a: {}, zz: {} } })).join() === "a", "per-slide: only existing own ids");
ok(targetSlideIds(song({})).length === 0, "untouched song → nothing");

const p = planLock(song({ appliedThemeId: "th" }), "T")!;
ok(p.slideUpdates.length === 1 && p.slideUpdates[0].id === "a", "only slides that CHANGE are written (b already locked, c legacy)");
ok((p.slideUpdates[0].objectsJson[0] as { styleLocked?: boolean }).styleLocked === true, "text gets styleLocked");
ok(!("styleLocked" in (p.slideUpdates[0].objectsJson[1] as object)), "shape untouched");
ok(JSON.stringify(p.settings[BACKFILL_KEY]) === JSON.stringify({ at: "T", slideIds: ["a"] }), "records exactly the touched slides");
ok(p.settings.appliedThemeId === "th", "existing settings preserved");

const done = song({ appliedThemeId: "th", [BACKFILL_KEY]: { at: "T", slideIds: ["a"] } });
ok(planLock(done, "T2") === null, "idempotent: already backfilled song skipped");
ok(planLock(song({}), "T") === null, "no marker → no plan");

const locked = song({ appliedThemeId: "th", [BACKFILL_KEY]: { at: "T", slideIds: ["a"] } }, [
  { id: "a", objectsJson: [txt("t1", { styleLocked: true })] },
  { id: "b", objectsJson: [txt("t2", { styleLocked: true })] },
]);
const r = planUnlock(locked)!;
ok(r.slideUpdates.length === 1 && r.slideUpdates[0].id === "a", "rollback touches ONLY recorded slides (b was locked by the operator, kept)");
ok(!("styleLocked" in (r.slideUpdates[0].objectsJson[0] as object)), "styleLocked removed");
ok(!(BACKFILL_KEY in r.settings) && r.settings.appliedThemeId === "th", "key deleted, rest kept");
ok(planUnlock(song({ appliedThemeId: "th" })) === null, "rollback idempotent without key");
console.log(`style-lock-backfill: ${n} assertions passed`);
