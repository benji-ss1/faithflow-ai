/**
 * Fonts P1 — registry: resolveFont / fontStack / pickers / nearestWeight.
 * Run: npx tsx test/fonts-registry.test.ts
 */
import assert from "node:assert/strict";
import fixture from "./fixtures/stored-font-values.json";
import { FONT_REGISTRY, FONT_PICKER_OPTIONS, resolveFont, fontStack, pickerOptionsFor, nearestWeight, weightOptionsFor, fontLoadSpec } from "../src/lib/fonts/registry";
import { themeConfigToAppearance } from "../src/lib/theme-appearance";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name} — ${(e as Error).message}`); fail++; }
}
const GENERIC_END = /(,\s*|^)(serif|sans-serif|monospace|system-ui|cursive)$/;
const FONT_FAMILY_RE = /^[a-zA-Z0-9 ,._'"-]{1,120}$/; // wire validator (broadcast.ts)

check("ids and families unique", () => {
  assert.equal(new Set(FONT_REGISTRY.map((e) => e.id)).size, FONT_REGISTRY.length);
  assert.equal(new Set(FONT_REGISTRY.map((e) => e.family.toLowerCase())).size, FONT_REGISTRY.length);
});
check("every font previously offered by ANY picker is still offered (no removal)", () => {
  const old = ["Inter", "Sora", "Plus Jakarta Sans", "Playfair Display", "Cormorant Garamond", "Fraunces", "Spectral", "Montserrat", "DM Serif Display", "Georgia", "Helvetica", "Arial", "Times New Roman", "Courier New", "Helvetica Neue"];
  const vals = FONT_PICKER_OPTIONS.map((o) => o.value);
  for (const f of old) assert.ok(vals.includes(f), f);
});
check("resolveFont: exact, case-insensitive, quoted, alias, stack", () => {
  assert.equal(resolveFont("Sora")?.id, "sora");
  assert.equal(resolveFont("inter")?.id, "inter");
  assert.equal(resolveFont("  Sora  ")?.id, "sora");
  assert.equal(resolveFont("'Times New Roman'")?.id, "times-new-roman");
  assert.equal(resolveFont("Times")?.id, "times-new-roman");
  assert.equal(resolveFont("Inter, system-ui, sans-serif")?.id, "inter");
  assert.equal(resolveFont("\"Playfair Display\", serif")?.id, "playfair-display");
});
check("resolveFont: unknown → undefined", () => {
  assert.equal(resolveFont("Comic Sans MS"), undefined);
  assert.equal(resolveFont("TEST"), undefined);
  assert.equal(resolveFont(""), undefined);
  assert.equal(resolveFont(undefined), undefined);
});
check("fontStack always ends in a generic for every fixture value", () => {
  const all = [...fixture.localDb, ...fixture.knownProd, ...fixture.pickerLegacy, ...fixture.stacks, ...fixture.oddballs];
  for (const v of all) {
    const out = fontStack(v)!;
    assert.ok(GENERIC_END.test(out.trim()), `${v} → ${out}`);
    assert.ok(FONT_FAMILY_RE.test(out), `wire-valid: ${out}`);
  }
});
check("fontStack classes: serif faces → serif, Helvetica → Arial chain, sans → sans-serif", () => {
  assert.equal(fontStack("Inter"), "Inter, sans-serif");
  assert.equal(fontStack("Georgia"), "Georgia, serif");
  assert.equal(fontStack("Times New Roman"), "Times New Roman, serif");
  assert.equal(fontStack("Playfair Display"), "Playfair Display, serif");
  assert.equal(fontStack("Cormorant Garamond"), "Cormorant Garamond, serif");
  assert.equal(fontStack("Helvetica"), "Helvetica, Helvetica Neue, Arial, sans-serif");
  assert.equal(fontStack("Courier New"), "Courier New, monospace");
  assert.equal(fontStack("Garamond"), "Garamond, serif");
  assert.equal(fontStack("Comic Sans MS"), "Comic Sans MS, sans-serif");
});
check("fontStack keeps complete stacks byte-identical", () => {
  for (const s of fixture.stacks) assert.equal(fontStack(s), s);
});
check("theme appearance output unchanged for legacy values (wire parity)", () => {
  assert.equal(themeConfigToAppearance({ fontFamily: "Inter" })?.fontFamily, "Inter, sans-serif");
  assert.equal(themeConfigToAppearance({ fontFamily: "Georgia" })?.fontFamily, "Georgia, serif");
  assert.equal(themeConfigToAppearance({ fontFamily: "Inter, sans-serif" })?.fontFamily, "Inter, sans-serif");
  assert.equal(themeConfigToAppearance({ fontFamily: "Playfair Display" })?.fontFamily, "Playfair Display, serif");
});
check("pickerOptionsFor: known value → no extra option; unknown → (current) first", () => {
  assert.equal(pickerOptionsFor("Sora").length, FONT_PICKER_OPTIONS.length);
  const o = pickerOptionsFor("Inter, system-ui, sans-serif");
  assert.equal(o[0].value, "Inter, system-ui, sans-serif");
  assert.equal(o[0].label, "(current) Inter, system-ui, sans-serif");
  assert.equal(pickerOptionsFor("TEST")[0].label, "(current) TEST");
});
check("weights: real per font, stored weight kept visible", () => {
  assert.deepEqual(weightOptionsFor("DM Serif Display"), [400]);
  assert.deepEqual(weightOptionsFor("Sora", 900), [100, 200, 300, 400, 500, 600, 700, 800, 900]);
  assert.deepEqual(weightOptionsFor("Unknown", 600), [300, 400, 500, 600, 700, 800, 900]);
  assert.equal(nearestWeight("Sora", 900), 800);
  assert.equal(nearestWeight("Georgia", 600), 700);
  assert.equal(nearestWeight("Cormorant Garamond", 250), 300);
  assert.equal(nearestWeight("nope", 650), 650);
});
check("fontLoadSpec", () => {
  assert.equal(fontLoadSpec("Plus Jakarta Sans, sans-serif", 700, true), "italic 700 48px Plus Jakarta Sans");
  assert.equal(fontLoadSpec("\"Sora\"", undefined, false), "400 48px Sora");
});
check("kill switch NEXT_PUBLIC_SLIDE_FONTS_V1=0 → raw pass-through", () => {
  const prev = process.env.NEXT_PUBLIC_SLIDE_FONTS_V1;
  process.env.NEXT_PUBLIC_SLIDE_FONTS_V1 = "0";
  try {
    assert.equal(fontStack("Sora"), "Sora");
    assert.equal(fontStack("Helvetica"), "Helvetica");
    // legacy theme mapper still applies its own generic
    assert.equal(themeConfigToAppearance({ fontFamily: "Georgia" })?.fontFamily, "Georgia, serif");
  } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_SLIDE_FONTS_V1; else process.env.NEXT_PUBLIC_SLIDE_FONTS_V1 = prev;
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
