/**
 * Themes 4 — colourway builder + smart contrast.
 * Run: npx tsx test/colorway.test.ts
 */
import assert from "node:assert";
import { buildColorwayFromPalette, readableTextColor, hexToRgb, rgbToHex } from "../src/lib/colorway";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name} — ${(e as Error).message}`); fail++; }
}

check("hexToRgb parses + rejects", () => {
  assert.deepStrictEqual(hexToRgb("#ff0000"), [255, 0, 0]);
  assert.deepStrictEqual(hexToRgb("00ff00"), [0, 255, 0]);
  assert.strictEqual(hexToRgb("nope"), null);
  assert.strictEqual(hexToRgb(""), null);
});

check("rgbToHex clamps + pads", () => {
  assert.strictEqual(rgbToHex(0, 0, 0), "#000000");
  assert.strictEqual(rgbToHex(255, 255, 255), "#ffffff");
  assert.strictEqual(rgbToHex(300, -5, 16), "#ff0010");
});

check("readableTextColor picks contrast", () => {
  assert.strictEqual(readableTextColor("#ffffff"), "#111111"); // light bg → dark text
  assert.strictEqual(readableTextColor("#f5f5dc"), "#111111"); // beige → dark
  assert.strictEqual(readableTextColor("#001a33"), "#ffffff"); // dark → white
  assert.strictEqual(readableTextColor("garbage"), "#ffffff"); // unparseable → safe default
});

check("buildColorwayFromPalette produces a valid, contrast-safe gradient", () => {
  const cw = buildColorwayFromPalette(["#e8a838", "#333333", "#0055aa"]);
  assert.ok(cw, "should build");
  assert.strictEqual(cw!.bgType, "gradient");
  for (const c of [cw!.bgColor, cw!.bgColor2, cw!.textColor]) assert.ok(/^#[0-9a-f]{6}$/.test(c), `valid hex: ${c}`);
  assert.ok(cw!.textColor === "#ffffff" || cw!.textColor === "#111111", "text is a contrast-safe extreme");
});

check("buildColorwayFromPalette handles empty / invalid input", () => {
  assert.strictEqual(buildColorwayFromPalette([]), null);
  assert.strictEqual(buildColorwayFromPalette(["notahex", "###"]), null);
});

check("picks the most vibrant colour as the brand hue", () => {
  // grey + vivid orange → the gradient should derive from the orange, not grey.
  const cw = buildColorwayFromPalette(["#808080", "#ff7a00"]);
  assert.ok(cw);
  const [r, g, b] = hexToRgb(cw!.bgColor)!;
  assert.ok(r > g && g > b, "dark orange-ish (r>g>b), not neutral grey");
});

console.log(`\n=== colorway: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
