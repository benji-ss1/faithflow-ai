// Theme Editor PR 1 — reset-theme-owned-fields-then-bake + backup preservation.
// Run: npx tsx test/theme-rebake.test.ts
import assert from "node:assert";
import { rebakeThemeFromOriginal, resetThemeOwnedFields, mergeThemeBackup, reapplySourceForSlide, themeFieldsForConfigs, reapplyFieldsForConfigs, pruneThemeBackup, copyThemeBackupForDuplicate, appendBakedConfig, readBakedConfigs, pickBakedConfig } from "../src/lib/theme-rebake";
import { readFileSync } from "node:fs";
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

check("re-apply only resets fields the new OR previous theme sets", () => {
  const orig = { objects: [{ id: "a", kind: "text", text: "x", fontWeight: 400, fontFamily: "Arial" }] };
  // operator bolded the text after the first apply; no theme version sets weight
  const cur = { objects: [{ id: "a", kind: "text", text: "x", fontWeight: 800, fontFamily: "Sora" }] };
  const fields = themeFieldsForConfigs([{ fontFamily: "Inter" }, { fontFamily: "Sora" }]);
  assert.deepEqual(fields.text, ["fontFamily"]);
  const re = rebakeThemeFromOriginal({ fontFamily: "Inter" }, cur, orig, fields) as any;
  assert.equal(re.objects[0].fontWeight, 800, "operator weight kept");
  assert.equal(re.objects[0].fontFamily, "Inter");
  // a field set only by the PREVIOUS theme is still cleared
  const prevOnly = themeFieldsForConfigs([{ fontFamily: "Inter" }, { bgImageUrl: "https://x/y.png", fontWeight: 900 }]);
  const re2 = rebakeThemeFromOriginal({ fontFamily: "Inter" }, { bgImageUrl: "https://x/y.png", ...cur }, orig, prevOnly) as any;
  assert.equal(re2.bgImageUrl, undefined);
  assert.equal(re2.objects[0].fontWeight, 400);
  assert.ok(themeFieldsForConfigs([{ bgColor: "#fff" }]).text.includes("color"), "bg colour drives auto-contrast text colour");
});
check("revert-style reset keeps lyric edits", () => {
  const baked = bakeThemeIntoObjectsJson({ fontFamily: "Sora", bgColor: "#123456" }, original) as any;
  baked.objects[0].text = "Edited lyric line";
  const restored = resetThemeOwnedFields(baked, original) as any;
  assert.equal(restored.objects[0].text, "Edited lyric line");
  assert.equal(restored.objects[0].fontFamily, "Arial");
  assert.equal(restored.bgColor, "#222222");
});
check("backup pruning drops deleted slides", () => {
  const b = { slides: [{ id: "s1", objectsJson: 1 }, { id: "gone", objectsJson: 2 }], themeId: "A" };
  assert.deepEqual(pruneThemeBackup(b, ["s1"]), { slides: [{ id: "s1", objectsJson: 1 }], themeId: "A" });
  assert.equal(pruneThemeBackup(undefined, ["s1"]), undefined);
});
check("duplicated slide inherits the source's pre-theme snapshot", () => {
  const settings = { appliedThemeId: "A", themeBackup: { slides: [{ id: "src", objectsJson: { o: "orig" } }], themeId: "A" }, slideThemeBackups: { src: { objectsJson: { o: "per" }, themeId: "B" } } };
  const next = copyThemeBackupForDuplicate(settings, "src", "copy") as any;
  assert.deepEqual(next.themeBackup.slides[1], { id: "copy", objectsJson: { o: "orig" } });
  assert.deepEqual(next.slideThemeBackups.copy, { objectsJson: { o: "per" }, themeId: "B" });
  assert.equal(copyThemeBackupForDuplicate({}, "src", "copy"), null);
});

check("keep-songs bg leftover: re-apply always resets bg even when neither config names it", () => {
  const orig = { bgColor: "#101010", objects: [{ id: "a", kind: "text", text: "x", fontWeight: 400 }] };
  // Slide still carries an image baked by an OLD theme version; the edit's
  // previousConfig was lost (e.g. editor reopened), so the key union is empty.
  const stale = { bgType: "image", bgImageUrl: "https://x/old.png", bgColor2: "#999999", transition: { effectId: "Fade" }, objects: [{ id: "a", kind: "text", text: "x", fontWeight: 900, fontFamily: "Sora" }] };
  const fields = reapplyFieldsForConfigs([{ fontFamily: "Inter" }, undefined]);
  const re = rebakeThemeFromOriginal({ fontFamily: "Inter" }, stale, orig, fields) as any;
  assert.equal(re.bgImageUrl, undefined);
  assert.equal(re.bgType, undefined);
  assert.equal(re.bgColor2, undefined);
  assert.equal(re.transition, undefined);
  assert.equal(re.bgColor, "#101010");
  // text key-union protection kept: fontWeight not named by any config survives
  assert.equal(re.objects[0].fontWeight, 900);
  assert.equal(re.objects[0].fontFamily, "Inter");
  // bgExplicit joined the theme-owned set (2026-09-21): a bake sets it alongside
  // the background, so a re-apply/undo must reset it in lockstep — otherwise a
  // stale `true` makes a restored default black paint as a deliberate choice.
  assert.deepEqual([...fields.slide].sort(), ["bgColor", "bgColor2", "bgExplicit", "bgImageUrl", "bgType", "transition"]);
  assert.equal(re.bgExplicit, undefined, "the original had no chosen background, so none is restored");
});

check("bgExplicit resets with the background it describes (no stale 'chosen' after undo)", () => {
  // The slide was baked by a black theme: real black + chosen. The pre-theme
  // original had an ordinary default black that nobody chose.
  const orig = { bgColor: "#000000", objects: [] };
  const baked = { bgColor: "#000000", bgExplicit: true, objects: [] };
  const fields = reapplyFieldsForConfigs([{ bgType: "solid", bgColor: "#000000" }, undefined]);
  const re = rebakeThemeFromOriginal({ fontFamily: "Inter" }, baked, orig, fields) as any;
  assert.equal(re.bgExplicit, undefined, "undoing the theme must not leave the slide pinned to opaque black");
});

// ── Server-stored baked configs (review fix: never trust client previousConfig) ──
// Simulates the actions.ts flow with the pure helpers: whole-song apply stores
// bakedConfigs; re-apply reads them from the SONG, not the editor.
const S_ORIG = { bgColor: "#000000", objects: [{ id: "a", kind: "text", text: "x" }] };
function applyWholeSong(cfg: Record<string, unknown>, current: unknown, settings: Record<string, unknown>) {
  const prevCfgs = readBakedConfigs((settings.themeBackup as any)?.bakedConfigs);
  const legacy = typeof settings.appliedThemeId === "string" && !prevCfgs;
  const merged = mergeThemeBackup(settings.themeBackup, [{ id: "s1", objectsJson: current }], "T");
  const bc = appendBakedConfig(prevCfgs, cfg, legacy);
  const { bakedConfigs: _d, ...rest } = merged; void _d;
  return { slide: bakeThemeIntoObjectsJson(cfg as any, current), settings: { ...settings, appliedThemeId: "T", themeBackup: bc ? { ...rest, bakedConfigs: bc } : rest } };
}
function reapply(cfg: Record<string, unknown>, current: unknown, settings: Record<string, unknown>) {
  const src = reapplySourceForSlide("T", { id: "s1", objectsJson: current }, settings)!;
  const fields = reapplyFieldsForConfigs([cfg, ...(src.bakedConfigs ?? [])]);
  return rebakeThemeFromOriginal(cfg as any, current, src.original, fields, src.bakedConfigs) as any;
}
const V1 = { bgType: "image", bgImageUrl: "https://x/v1.png" };
const V2 = { bgType: "image", bgImageUrl: "https://x/v2.png" };
const V3 = { bgColor: "#223344" };

check("stale older-version song ('Keep songs as they are'): v1-baked song is updated on v3 re-apply", () => {
  const a = applyWholeSong(V1, S_ORIG, {});
  assert.deepEqual((a.settings.themeBackup as any).bakedConfigs, [V1]);
  // theme edited to v2 WITHOUT restyling this song, then to v3 and re-applied
  const re = reapply(V3, a.slide, a.settings);
  assert.equal(re.bgImageUrl, undefined, "v1 image leftover reset");
  assert.equal(re.bgType, undefined);
  assert.equal(re.bgColor, "#223344");
});
check("hand-set background after applying is KEPT on re-apply", () => {
  const a = applyWholeSong(V1, S_ORIG, {});
  const operator = { ...a.slide, bgImageUrl: "https://x/operator-flyer.png" };
  const re = reapply(V2, operator, a.settings);
  assert.equal(re.bgImageUrl, "https://x/operator-flyer.png");
});
check("legacy song (no stored baked config) keeps today's reset-all behaviour", () => {
  const legacySettings = { appliedThemeId: "T", themeBackup: { slides: [{ id: "s1", objectsJson: S_ORIG }], themeId: "T" } };
  const cur = { ...S_ORIG, bgType: "image", bgImageUrl: "https://x/anything.png" };
  const re = reapply(V3, cur, legacySettings);
  assert.equal(re.bgImageUrl, undefined);
  assert.equal(re.bgColor, "#223344");
  // and re-applying a legacy-themed song with a new theme stays legacy (no guessed configs)
  assert.equal(appendBakedConfig(undefined, V3, true), undefined);
});
check("two-operator stale editor: a stale client previousConfig cannot change the outcome", () => {
  const a = applyWholeSong(V2, S_ORIG, {});
  const operator = { ...a.slide, bgImageUrl: "https://x/operator-flyer.png" };
  // Operator B's editor still thinks the previous config was V1 — irrelevant now:
  const re = reapply(V3, operator, a.settings);
  assert.equal(re.bgImageUrl, "https://x/operator-flyer.png", "hand-set kept");
  const re2 = reapply(V3, a.slide, a.settings);
  assert.equal(re2.bgImageUrl, undefined, "theme-owned v2 image reset");
  const src = readFileSync(new URL("../src/lib/actions.ts", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("export async function reapplyThemeToSongs("), src.indexOf("// Themes 4 — extract"));
  assert.ok(!/opts\.previousConfig/.test(body), "reapply never reads client previousConfig");
  assert.ok(/src\.bakedConfigs/.test(body));
});
check("baked config stored is bake-only (no layout blob) and capped", () => {
  assert.deepEqual(pickBakedConfig({ bgColor: "#111111", layout: { version: 3 }, logoUrl: "https://x" }), { bgColor: "#111111" });
  let list: any = [];
  for (let i = 0; i < 8; i++) list = appendBakedConfig(list, { bgColor: `#00000${i}` }, false);
  assert.equal(list.length, 5);
});

console.log(`\ntheme-rebake: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
