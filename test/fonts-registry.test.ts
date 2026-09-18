/**
 * Fonts P1 — registry: resolveFont / fontStack / pickers / nearestWeight.
 * Run: npx tsx test/fonts-registry.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fixture from "./fixtures/stored-font-values.json";
import { FONT_REGISTRY, FONT_PICKER_OPTIONS, resolveFont, fontStack, pickerOptionsFor, selectedFontValue, nearestWeight, weightOptionsFor, fontLoadSpec } from "../src/lib/fonts/registry";
import { themeConfigToAppearance } from "../src/lib/theme-appearance";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
check("pickerOptionsFor: known value or stack → no extra option; unknown → Keep current first", () => {
  assert.equal(pickerOptionsFor("Sora").length, FONT_PICKER_OPTIONS.length);
  // A stored CSS STACK (what the ThemesTab swatches write) must select its plain
  // registry option, not show a redundant "Keep current" row.
  const stack = pickerOptionsFor("Inter, system-ui, sans-serif");
  assert.equal(stack.length, FONT_PICKER_OPTIONS.length);
  assert.ok(!stack.some((o) => o.group === "current"));
  assert.equal(selectedFontValue("Inter, system-ui, sans-serif"), "Inter");
  // Only a genuinely unrecognised value is preserved as its own option.
  const unknown = pickerOptionsFor("TEST");
  assert.equal(unknown[0].label, "Keep current: TEST");
  assert.equal(unknown[0].group, "current");
  assert.equal(selectedFontValue("TEST"), "TEST");
});
check("default projector face: Yoruba/Igbo letters land on Inter, not the OS font", () => {
  // Sora is the default --font-display face and has NO ẹ ọ ṣ ị ụ ṅ. Inter must
  // sit IMMEDIATELY after it so per-glyph fallback lands on a bundled face.
  const sora = FONT_REGISTRY.find((e) => e.id === "sora")!;
  assert.equal(sora.supports.yoruba, false);
  assert.deepEqual(sora.fallbacks, ["Inter"]);
  const inter = FONT_REGISTRY.find((e) => e.id === "inter")!;
  assert.ok(inter.supports.yoruba && inter.supports.igbo && inter.bundled);
  const stack = fontStack("Sora")!;
  assert.equal(stack, "Sora, Inter, sans-serif");
  // Inter must come BEFORE any generic/system face in the resolved stack.
  const fams = stack.split(",").map((s) => s.trim());
  assert.ok(fams.indexOf("Inter") === 1, stack);
  // The CSS variable used by the live projector must agree with the registry.
  const css = fs.readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
  const decl = /--font-display:\s*([^;]+);/.exec(css)?.[1] ?? "";
  const list = decl.split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, ""));
  assert.equal(list[0], "Sora", decl);
  assert.equal(list[1], "Inter", `Inter must come straight after Sora: ${decl}`);
});
check("picker grouping + coverage hints (wires the registry supports flags)", () => {
  const opts = pickerOptionsFor("Sora");
  assert.equal(opts.find((o) => o.value === "Sora")?.group, "bundled");
  assert.equal(opts.find((o) => o.value === "Georgia")?.group, "system");
  // Sora genuinely has no Yoruba/Igbo glyphs, so the picker must say so.
  assert.equal(opts.find((o) => o.value === "Sora")?.hint, "limited Yoruba/Igbo");
  assert.equal(opts.find((o) => o.value === "Inter")?.hint, undefined);
  assert.ok(opts.every((o) => o.group !== "bundled" || o.entry?.bundled));
});
check("fontStack is defensive: CSS punctuation never reaches the declaration", () => {
  for (const evil of ['Sora; } body{display:none', "Inter<script>", "A(B)", "X\\nY", "Georgia; color:red"]) {
    const out = fontStack(evil)!;
    assert.ok(!/[;{}()<>\\]/.test(out), `${evil} → ${out}`);
    assert.ok(GENERIC_END.test(out) || ["serif", "sans-serif", "monospace"].includes(out), out);
  }
  // A serif-classed first family still degrades to serif, not sans-serif.
  assert.equal(fontStack("Georgia; color:red"), "serif");
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
