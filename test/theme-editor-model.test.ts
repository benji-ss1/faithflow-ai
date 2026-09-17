// Theme Editor PR 1 — config → editor rows → save config round trip, and the
// single typography source of truth (text boxes).
// Run: npx tsx test/theme-editor-model.test.ts
import assert from "node:assert";
import { themeLayoutToRows, buildThemeSaveConfig, typographyTargetOf, parseThemeFontSize, mainTextOf, verseTextOf } from "../src/lib/theme-editor-model";
import { normalizeEditableSlide, type TextObject } from "../src/lib/slide-objects";
import { sanitizeThemeLayout } from "../src/lib/theme-layout";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log("  PASS " + name); pass++; }
  catch (e) { console.error("  FAIL " + name + "\n    " + (e as Error).message); fail++; }
}
const FLAT = ["fontFamily", "fontSizePx", "fontWeight", "textColor", "align", "textShadow", "fontSizeScripturePx"] as const;

check("legacy flat config round-trips unchanged (seeded slide)", () => {
  const cfg = { fontFamily: "Sora", fontSizePx: 80, fontWeight: 700, textColor: "#eeeeee", align: "left", textShadow: true, fontSizeScripturePx: 60, bgType: "gradient", bgColor: "#101010", bgAngle: 45 };
  const { rows, meta } = themeLayoutToRows(cfg);
  const saved = buildThemeSaveConfig(cfg, rows.map(normalizeEditableSlide), meta);
  for (const k of FLAT) assert.deepEqual(saved[k], (cfg as Record<string, unknown>)[k], k);
  assert.equal(saved.bgAngle, 45);
  assert.equal(saved.bgColor, "#101010");
});

check("config with a layout round-trips (layout + flat fields identical)", () => {
  const layout = {
    version: 3,
    slides: [
      { id: "s_lyr", name: "Lyrics", role: "lyrics", objects: [{ id: "m", kind: "text", x: 0, y: 0, w: 100, h: 100, text: "L", fontFamily: "Inter", fontSize: 90, fontWeight: 600, color: "#ffffff", align: "center", shadow: false, role: "main" }] },
      { id: "s_scr", name: "Scripture", role: "scripture", objects: [
        { id: "v", kind: "text", x: 0, y: 0, w: 100, h: 100, text: "V", fontSize: 55, role: "verse" },
        { id: "r", kind: "text", x: 0, y: 200, w: 100, h: 50, text: "R", fontSize: 30, role: "reference" },
      ] },
    ],
  };
  const cfg = { fontFamily: "Inter", fontSizePx: 90, fontWeight: 600, textColor: "#ffffff", align: "center", textShadow: false, fontSizeScripturePx: 55, layout };
  const { rows, meta } = themeLayoutToRows(cfg);
  const saved = buildThemeSaveConfig(cfg, rows.map(normalizeEditableSlide), meta);
  for (const k of FLAT) assert.deepEqual(saved[k], (cfg as Record<string, unknown>)[k], k);
  assert.deepEqual(sanitizeThemeLayout(saved.layout), sanitizeThemeLayout(layout));
});

check("typography edits on the boxes are what save derives", () => {
  const cfg = { fontSizePx: 72 };
  const { rows, meta } = themeLayoutToRows(cfg);
  const slides = rows.map(normalizeEditableSlide);
  const t = typographyTargetOf(slides[0].objects, meta[slides[0].id].role) as TextObject;
  t.fontSize = 120; t.fontFamily = "Georgia"; t.shadow = true;
  const saved = buildThemeSaveConfig(cfg, slides, meta);
  assert.equal(saved.fontSizePx, 120);
  assert.equal(saved.fontFamily, "Georgia");
  assert.equal(saved.textShadow, true);
});

check("scripture slide targets its verse box; scripture size from verse", () => {
  const objs = [
    { id: "a", kind: "text", x: 0, y: 0, w: 1, h: 1, text: "", role: "reference" },
    { id: "b", kind: "text", x: 0, y: 0, w: 1, h: 1, text: "", role: "verse", fontSize: 44 },
  ] as TextObject[];
  assert.equal(typographyTargetOf(objs, "scripture")?.id, "b");
  assert.equal(verseTextOf(objs)?.id, "b");
  assert.equal(mainTextOf(objs), null, "roles in use but no main box");
});

check("font size parsing refuses 0 / empty / NaN / out of range", () => {
  assert.equal(parseThemeFontSize(""), null);
  assert.equal(parseThemeFontSize("0"), null);
  assert.equal(parseThemeFontSize("abc"), null);
  assert.equal(parseThemeFontSize("11"), null);
  assert.equal(parseThemeFontSize("401"), null);
  assert.equal(parseThemeFontSize("96"), 96);
});

console.log(`\ntheme-editor-model: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
