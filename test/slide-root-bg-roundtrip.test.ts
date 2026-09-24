/**
 * Theme background survives load → edit → save (round 4 🔴 fix).
 * A theme baked onto a blank / legacy slide lives on the ROOT of objectsJson
 * with `objects: []`. normalizeEditableSlide used to ignore it and
 * saveSlideObjects rewrote only 4 keys — the first lyric edit wiped the theme.
 * Run: npx tsx test/slide-root-bg-roundtrip.test.ts
 */
import assert from "node:assert/strict";
import { normalizeEditableSlide, mergeSavedSlideRoot, extractLyricsFromEditable, type TextObject } from "../src/lib/slide-objects";
import { bakeThemeIntoObjectsJson } from "../src/lib/theme-bake";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; } catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).stack}`); fail++; }
}
const TRANS = { effectId: "fade", durationMs: 400, easing: "ease" };

/** Simulate the editor: load, type lyrics into the first text object, save. */
function editAndSave(stored: unknown, lyrics: string, text: string) {
  const ed = normalizeEditableSlide({ id: "s1", lyrics, objectsJson: stored });
  const objects = ed.objects.map((o, i) => (i === 0 && o.kind === "text" ? { ...(o as TextObject), text } : o));
  return { editor: ed, saved: mergeSavedSlideRoot(stored, { bgColor: ed.bgColor, bgImageUrl: ed.bgImageUrl, bgExplicit: ed.bgExplicit, objects }) };
}

console.log("slide root background round-trip");

check("theme-baked BLANK slide (objects: []) — editor loads the red bg", () => {
  const stored = bakeThemeIntoObjectsJson({ bgType: "solid", bgColor: "#cc0000", transition: TRANS }, null);
  assert.deepEqual(stored.objects, []);
  const ed = normalizeEditableSlide({ id: "s1", lyrics: "", objectsJson: stored });
  assert.equal(ed.bgColor, "#cc0000");
  assert.equal(ed.bgExplicit, true);
  assert.deepEqual(ed.transition, TRANS);
  assert.equal(ed.objects.length, 1, "still a synthesized editable text box");
});
check("first lyric edit + save of a themed blank slide KEEPS bg, bgType, bgExplicit, transition", () => {
  const stored = bakeThemeIntoObjectsJson({ bgType: "solid", bgColor: "#cc0000", transition: TRANS }, null);
  const { saved } = editAndSave(stored, "", "Way maker, miracle worker");
  assert.equal(saved.bgColor, "#cc0000");
  assert.equal(saved.bgExplicit, true);
  assert.equal(saved.bgType, "solid");
  assert.deepEqual(saved.transition, TRANS);
  assert.equal((saved.objects as TextObject[])[0].text, "Way maker, miracle worker");
});
check("NON-empty objects: save keeps bgType / bgColor2 / transition / unknown root keys", () => {
  const stored = { bgType: "solid", bgColor: "#123456", bgColor2: "#654321", bgExplicit: true, transition: TRANS, links: [{ to: "x" }], objects: [{ id: "a", kind: "text", x: 0, y: 0, w: 10, h: 10, text: "old" }] };
  const { editor, saved } = editAndSave(stored, "old", "new");
  assert.equal(editor.bgColor, "#123456");
  assert.equal(saved.bgType, "solid");
  assert.equal(saved.bgColor2, "#654321");
  assert.deepEqual(saved.transition, TRANS);
  assert.deepEqual(saved.links, [{ to: "x" }]);
  assert.equal(saved.bgExplicit, true);
  assert.equal((saved.objects as TextObject[])[0].text, "new");
});
check("editor-owned keys still win: clearing the bg image / colour in the editor clears it", () => {
  const stored = { bgColor: "#123456", bgImageUrl: "https://cdn/x.png", bgExplicit: true, objects: [] };
  const saved = mergeSavedSlideRoot(stored, { bgColor: undefined, bgImageUrl: undefined, bgExplicit: undefined, objects: [] });
  assert.equal(saved.bgColor, undefined);
  assert.equal(saved.bgImageUrl, undefined);
  assert.equal("bgExplicit" in saved, false);
});
check("explicit transition in the save input replaces the stored one", () => {
  const saved = mergeSavedSlideRoot({ transition: TRANS, objects: [] }, { objects: [], transition: { effectId: "cut", durationMs: 0, easing: "linear" } });
  assert.deepEqual(saved.transition, { effectId: "cut", durationMs: 0, easing: "linear" });
});
check("legacy rows unchanged: null objectsJson ⇒ same synthesized slide, no bg", () => {
  const ed = normalizeEditableSlide({ id: "s1", lyrics: "Amazing grace", objectsJson: null });
  assert.equal(ed.bgColor, undefined);
  assert.equal(ed.bgExplicit, undefined);
  assert.equal(extractLyricsFromEditable(ed), "Amazing grace");
  const saved = mergeSavedSlideRoot(null, { bgColor: ed.bgColor, bgImageUrl: ed.bgImageUrl, bgExplicit: ed.bgExplicit, objects: ed.objects });
  assert.deepEqual(Object.keys(saved).filter((k) => saved[k] !== undefined), ["objects"]);
});
check("non-empty objects rows normalize exactly as before", () => {
  const stored = { bgColor: "#000000", objects: [{ id: "a", kind: "text", x: 0, y: 0, w: 10, h: 10, text: "t" }] };
  const ed = normalizeEditableSlide({ id: "s1", lyrics: "t", objectsJson: stored });
  assert.deepEqual(ed, { id: "s1", bgColor: "#000000", bgImageUrl: undefined, bgExplicit: undefined, objects: stored.objects, transition: undefined, lyrics: "t" });
});
check("garbage root values are ignored (type-checked)", () => {
  const ed = normalizeEditableSlide({ id: "s1", lyrics: "x", objectsJson: { bgColor: 5, bgImageUrl: {}, bgExplicit: "yes", transition: "fade", objects: [] } });
  assert.equal(ed.bgColor, undefined);
  assert.equal(ed.bgImageUrl, undefined);
  assert.equal(ed.bgExplicit, undefined);
  assert.equal(ed.transition, undefined);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
