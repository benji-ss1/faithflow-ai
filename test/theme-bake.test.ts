// Tests the pure theme-bake helper used by the per-slide theme override.
// Run: npx tsx test/theme-bake.test.ts
import assert from "node:assert";
import { bakeThemeIntoObjectsJson } from "../src/lib/theme-bake";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log("  PASS " + name); pass++; }
  catch (e) { console.error("  FAIL " + name + "\n    " + (e as Error).message); fail++; }
}
const textObj = (extra: Record<string, unknown> = {}) => ({ kind: "text", text: "Hi", ...extra });

check("bakes font + color + align onto text objects (solid bg)", () => {
  const out = bakeThemeIntoObjectsJson(
    { fontFamily: "Inter", fontSizePx: 72, fontWeight: 700, textColor: "#ffffff", align: "center", bgType: "solid", bgColor: "#222222" },
    { objects: [textObj({ fontFamily: "Arial", color: "#000000" })] },
  );
  const o = (out.objects as any[])[0];
  assert.equal(o.fontFamily, "Inter");
  assert.equal(o.fontSize, 72);
  assert.equal(o.fontWeight, 700);
  assert.equal(o.align, "center");
  assert.equal(o.color, "#ffffff"); // white on dark = readable, kept
  assert.equal(out.bgColor, "#222222");
});

check("non-text objects are untouched", () => {
  const img = { kind: "image", url: "x", fit: "cover" };
  const out = bakeThemeIntoObjectsJson({ fontFamily: "Inter" }, { objects: [img] });
  assert.deepEqual((out.objects as any[])[0], img);
});

check("pure-black bg baked as near-black sentinel #010101", () => {
  const out = bakeThemeIntoObjectsJson({ bgType: "solid", bgColor: "#000000" }, { objects: [] });
  assert.equal(out.bgColor, "#010101");
});

check("gradient theme does NOT bake bgColor (leaves slide bg for live gradient)", () => {
  const out = bakeThemeIntoObjectsJson(
    { bgType: "gradient", bgColor: "#ff0000", bgColor2: "#00ff00" },
    { bgColor: "#111111", objects: [] },
  );
  assert.equal(out.bgColor, "#111111"); // unchanged
});

check("contrast guard: light text on light bg flips to readable", () => {
  const out = bakeThemeIntoObjectsJson(
    { bgType: "solid", bgColor: "#ffffff", textColor: "#f0f0f0" },
    { objects: [textObj()] },
  );
  const o = (out.objects as any[])[0];
  assert.equal(o.color, "#111111"); // white-on-white → dark text
});

check("transition + bgImageUrl are baked through", () => {
  const out = bakeThemeIntoObjectsJson(
    { transition: { effectId: "fade_in", durationMs: 500, easing: "ease" }, bgImageUrl: "https://x/y.png" },
    { objects: [] },
  );
  assert.equal((out.transition as any).effectId, "fade_in");
  assert.equal(out.bgImageUrl, "https://x/y.png");
});

check("missing objectsJson → safe empty result", () => {
  const out = bakeThemeIntoObjectsJson({ fontFamily: "Inter" }, null);
  assert.deepEqual(out.objects, []);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
