// Theme Editor PR 1 — theme layout + numeric key validation.
// Run: npx tsx test/theme-layout-sanitize.test.ts
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { sanitizeThemeLayout, clampThemeNumber, MAX_THEME_LAYOUT_SLIDES, MAX_THEME_LAYOUT_BYTES } from "../src/lib/theme-layout";
import { MAX_SLIDE_OBJECTS } from "../src/lib/broadcast";
import { themeConfigToAppearance } from "../src/lib/theme-appearance";
import { themeLayoutToRows, buildThemeSaveConfig } from "../src/lib/theme-editor-model";
import { normalizeEditableSlide } from "../src/lib/slide-objects";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log("  PASS " + name); pass++; }
  catch (e) { console.error("  FAIL " + name + "\n    " + (e as Error).message); fail++; }
}
const text = (extra: Record<string, unknown> = {}) => ({ id: "t1", kind: "text", x: 80, y: 300, w: 1760, h: 400, text: "Hi", ...extra });
const slide = (extra: Record<string, unknown> = {}) => ({ id: "s1", name: "Lyrics", role: "lyrics", objects: [text()], ...extra });

check("valid layout round-trips", () => {
  const out = sanitizeThemeLayout({ version: 3, slides: [slide({ bgColor: "#112233" })] });
  assert.ok(out);
  assert.equal(out!.slides.length, 1);
  assert.equal(out!.slides[0].role, "lyrics");
  assert.equal(out!.slides[0].bgColor, "#112233");
  assert.equal(out!.slides[0].objects.length, 1);
});
check("wrong version / shape rejected", () => {
  assert.equal(sanitizeThemeLayout({ version: 2, slides: [] }), undefined);
  assert.equal(sanitizeThemeLayout({ version: 3 }), undefined);
  assert.equal(sanitizeThemeLayout("x"), undefined);
  assert.equal(sanitizeThemeLayout([]), undefined);
});
check("hostile objects dropped, valid kept", () => {
  const out = sanitizeThemeLayout({ version: 3, slides: [slide({ objects: [
    text(),
    { id: "bad1", kind: "script", x: 0, y: 0, w: 1, h: 1 },
    text({ id: "bad2", x: Infinity }),
    text({ id: "bad3", color: "red;background:url(x)" }),
    { id: "img1", kind: "image", x: 0, y: 0, w: 10, h: 10, url: "javascript:alert(1)" },
    { id: "img2", kind: "image", x: 0, y: 0, w: 10, h: 10, url: "https://cdn.example.com/a.png" },
    text({ id: "../evil" }),
  ] })] });
  const ids = out!.slides[0].objects.map((o) => o.id);
  assert.deepEqual(ids, ["t1", "img2"]);
});
check("prototype-pollution keys rejected", () => {
  const polluted = JSON.parse('{"id":"p1","kind":"text","x":0,"y":0,"w":1,"h":1,"text":"a","__proto__":{"x":1}}');
  const out = sanitizeThemeLayout({ version: 3, slides: [slide({ objects: [polluted, text()] })] });
  assert.deepEqual(out!.slides[0].objects.map((o) => o.id), ["t1"]);
  const pollSlide = JSON.parse('{"id":"s9","name":"x","objects":[],"constructor":{}}');
  assert.equal(sanitizeThemeLayout({ version: 3, slides: [pollSlide] })!.slides.length, 0);
  assert.equal(sanitizeThemeLayout(JSON.parse('{"version":3,"slides":[],"__proto__":{}}')), undefined);
});
check("bad slide bg url / colour dropped, slide kept", () => {
  const out = sanitizeThemeLayout({ version: 3, slides: [slide({ bgImageUrl: "javascript:x", bgColor: "expression(1)" })] });
  assert.equal(out!.slides.length, 1);
  assert.equal(out!.slides[0].bgImageUrl, undefined);
  assert.equal(out!.slides[0].bgColor, undefined);
});
check("invalid role removed, unknown slide role dropped", () => {
  const out = sanitizeThemeLayout({ version: 3, slides: [slide({ role: "admin", objects: [text({ role: "boss" }), { id: "sh", kind: "shape", shape: "rect", x: 0, y: 0, w: 1, h: 1, role: "main" }] })] });
  assert.equal(out!.slides[0].role, undefined);
  assert.equal((out!.slides[0].objects[0] as any).role, undefined);
  assert.equal((out!.slides[0].objects[1] as any).role, undefined);
  const ok = sanitizeThemeLayout({ version: 3, slides: [slide({ objects: [text({ role: "verse" })] })] });
  assert.equal((ok!.slides[0].objects[0] as any).role, "verse");
});
check("slide and object caps enforced", () => {
  const many = Array.from({ length: 30 }, (_, i) => slide({ id: "s" + i }));
  assert.equal(sanitizeThemeLayout({ version: 3, slides: many })!.slides.length, MAX_THEME_LAYOUT_SLIDES);
  const objs = Array.from({ length: 200 }, (_, i) => text({ id: "o" + i }));
  assert.equal(sanitizeThemeLayout({ version: 3, slides: [slide({ objects: objs })] })!.slides[0].objects.length, MAX_SLIDE_OBJECTS);
});
check("duplicate slide ids dropped", () => {
  assert.equal(sanitizeThemeLayout({ version: 3, slides: [slide(), slide()] })!.slides.length, 1);
});
check("oversized layout rejected", () => {
  const big = "x".repeat(4900);
  const objs = Array.from({ length: 60 }, (_, i) => text({ id: "o" + i, text: big }));
  const slides = Array.from({ length: 12 }, (_, i) => slide({ id: "s" + i, objects: objs }));
  assert.ok(JSON.stringify({ version: 3, slides }).length > MAX_THEME_LAYOUT_BYTES);
  assert.equal(sanitizeThemeLayout({ version: 3, slides }), undefined);
});
check("numeric clamps", () => {
  assert.equal(clampThemeNumber(400, 0, 360), 360);
  assert.equal(clampThemeNumber(-1, 0, 1), 0);
  assert.equal(clampThemeNumber(0.4, 0, 1), 0.4);
  assert.equal(clampThemeNumber(NaN, 0, 1), undefined);
  assert.equal(clampThemeNumber("0.5", 0, 1), undefined);
});
check("sanitizeThemeConfig wires the dedicated validators", () => {
  const src = readFileSync("src/lib/actions.ts", "utf8");
  assert.match(src, /"layout", "bgAngle", "dim", "logoOpacity"/);
  assert.match(src, /sanitizeThemeLayout\(obj\[k\]\)/);
  assert.match(src, /clampThemeNumber\(obj\[k\], 0, 360\)/);
});
check("logo middle-center maps to center (was bottom-right)", () => {
  const a = themeConfigToAppearance({ logoUrl: "https://cdn.example.com/l.png", logoPosition: "middle-center" } as any);
  assert.equal(a?.logoPosition, "center");
});
check("editor model: seeds a Lyrics slide from flat config, and save derives flat fields", () => {
  const cfg = { fontFamily: "Sora", fontSizePx: 80, textColor: "#eeeeee", bgColor: "#101010" };
  const { rows, meta } = themeLayoutToRows(cfg);
  assert.equal(rows.length, 1);
  assert.equal(meta[rows[0].id].role, "lyrics");
  const slides = rows.map(normalizeEditableSlide);
  const t = slides[0].objects[0] as any;
  assert.equal(t.fontFamily, "Sora");
  t.fontSize = 90; t.color = "#abcdef";
  const saved = buildThemeSaveConfig(cfg, slides, meta);
  assert.equal(saved.fontSizePx, 90);
  assert.equal(saved.textColor, "#abcdef");
  const layout = sanitizeThemeLayout(saved.layout);
  assert.ok(layout);
  assert.equal(layout!.slides[0].name, "Lyrics");
  const back = themeLayoutToRows(saved);
  assert.equal(back.rows[0].id, rows[0].id);
});

console.log(`\ntheme-layout-sanitize: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
