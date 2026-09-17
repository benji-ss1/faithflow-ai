// Theme Editor PR 1 — reset-theme-owned-fields-then-bake + backup preservation.
// Run: npx tsx test/theme-rebake.test.ts
import assert from "node:assert";
import { rebakeThemeFromOriginal, resetThemeOwnedFields, mergeThemeBackup, reapplySourceForSlide } from "../src/lib/theme-rebake";
import { bakeThemeIntoObjectsJson } from "../src/lib/theme-bake";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log("  PASS " + name); pass++; }
  catch (e) { console.error("  FAIL " + name + "\n    " + (e as Error).message); fail++; }
}
const original = { bgColor: "#222222", objects: [{ id: "a", kind: "text", text: "Amazing grace", fontFamily: "Arial", color: "#ffffff" }] };

check("a field removed from the theme does not stick", () => {
  const themeV1 = { bgType: "image" as const, bgImageUrl: "https://cdn.example.com/bg.png", fontFamily: "Sora", fontSizePx: 90 };
  const baked = bakeThemeIntoObjectsJson(themeV1, original);
  assert.equal(baked.bgImageUrl, "https://cdn.example.com/bg.png");
  const themeV2 = { fontFamily: "Sora" }; // image + size removed
  const naive = bakeThemeIntoObjectsJson(themeV2, baked);
  assert.equal(naive.bgImageUrl, "https://cdn.example.com/bg.png", "sanity: naive re-bake keeps the stale image");
  const re = rebakeThemeFromOriginal(themeV2, baked, original);
  assert.equal(re.bgImageUrl, undefined);
  assert.equal(re.bgType, undefined);
  const o = (re.objects as any[])[0];
  assert.equal(o.fontSize, undefined);
  assert.equal(o.fontFamily, "Sora");
});
check("lyric/text edits made after the first apply are kept", () => {
  const baked = bakeThemeIntoObjectsJson({ fontFamily: "Sora" }, original) as any;
  baked.objects[0].text = "Amazing grace, how sweet the sound";
  baked.objects.push({ id: "b", kind: "text", text: "new box", color: "#00ff00" });
  const re = rebakeThemeFromOriginal({ fontFamily: "Inter" }, baked, original) as any;
  assert.equal(re.objects[0].text, "Amazing grace, how sweet the sound");
  assert.equal(re.objects[0].fontFamily, "Inter");
  assert.equal(re.objects.length, 2);
  assert.equal(re.objects[1].text, "new box");
});
check("idempotent", () => {
  const cfg = { bgType: "solid" as const, bgColor: "#eeeeee", textColor: "#eeeeee", fontWeight: 700 };
  const once = rebakeThemeFromOriginal(cfg, original, original);
  const twice = rebakeThemeFromOriginal(cfg, once, original);
  assert.deepEqual(twice, once);
});
check("reset restores original values and removes theme-only ones", () => {
  const cur = { bgColor: "#abcdef", bgColor2: "#000000", transition: { effectId: "Fade" }, objects: [{ id: "a", kind: "text", text: "x", fontFamily: "Sora", align: "left" }] };
  const r = resetThemeOwnedFields(cur, original) as any;
  assert.equal(r.bgColor, "#222222");
  assert.equal(r.bgColor2, undefined);
  assert.equal(r.transition, undefined);
  assert.equal(r.objects[0].fontFamily, "Arial");
  assert.equal(r.objects[0].align, undefined);
  assert.equal(r.objects[0].text, "x");
});
check("backup: first snapshot preserved, later slides added", () => {
  const first = mergeThemeBackup(undefined, [{ id: "s1", objectsJson: { v: "orig" } }], "A");
  const second = mergeThemeBackup(first, [{ id: "s1", objectsJson: { v: "themed-A" } }, { id: "s2", objectsJson: { v: "new" } }], "B");
  assert.deepEqual(second.slides, [{ id: "s1", objectsJson: { v: "orig" } }, { id: "s2", objectsJson: { v: "new" } }]);
  assert.equal(second.themeId, "B");
  const third = mergeThemeBackup(second, [{ id: "s1", objectsJson: { v: "themed-B" } }], "B");
  assert.deepEqual(third.slides[0].objectsJson, { v: "orig" });
});
check("reapply source: per-slide override of another theme is skipped", () => {
  const settings = { appliedThemeId: "A", themeBackup: { slides: [{ id: "s1", objectsJson: { o: 1 } }] }, slideThemeBackups: { s2: { objectsJson: { o: 2 }, themeId: "B" }, s3: { objectsJson: { o: 3 } } } };
  assert.deepEqual(reapplySourceForSlide("A", { id: "s1", objectsJson: {} }, settings), { original: { o: 1 }, addToBackup: false });
  assert.equal(reapplySourceForSlide("A", { id: "s2", objectsJson: {} }, settings), null);
  assert.equal(reapplySourceForSlide("A", { id: "s3", objectsJson: {} }, settings), null, "legacy override (no themeId) skipped");
  assert.deepEqual(reapplySourceForSlide("B", { id: "s2", objectsJson: {} }, settings), { original: { o: 2 }, addToBackup: false });
  assert.deepEqual(reapplySourceForSlide("A", { id: "s9", objectsJson: { cur: 1 } }, settings), { original: { cur: 1 }, addToBackup: true });
  assert.equal(reapplySourceForSlide("C", { id: "s1", objectsJson: {} }, settings), null);
});

console.log(`\ntheme-rebake: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
