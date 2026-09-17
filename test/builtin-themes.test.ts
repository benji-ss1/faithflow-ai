import { readFileSync } from "node:fs";
// Built-in themes — pure constants, sanitize round-trip, layout validity.
// Run: npx tsx test/builtin-themes.test.ts
import assert from "node:assert/strict";
import { BUILTIN_THEMES, isBuiltinThemeId, getBuiltinTheme, builtinThemeConfig } from "../src/lib/builtin-themes";
import { sanitizeThemeConfig, stripBuiltinId } from "../src/lib/theme-config";
import { sanitizeThemeLayout } from "../src/lib/theme-layout";
import { themeConfigToAppearance } from "../src/lib/theme-appearance";
import { isValidThemeAppearance } from "../src/lib/broadcast";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log("  PASS " + name); pass++; }
  catch (e) { console.error("  FAIL " + name + "\n    " + (e as Error).message); fail++; }
}

check("seven built-ins with the expected names", () => {
  assert.deepEqual(BUILTIN_THEMES.map((t) => t.name), ["Default", "Classic", "Modern", "Minimal", "Church", "Dark", "Light"]);
});
check("unique ids + names, ids are builtin:<slug>", () => {
  assert.equal(new Set(BUILTIN_THEMES.map((t) => t.id)).size, BUILTIN_THEMES.length);
  assert.equal(new Set(BUILTIN_THEMES.map((t) => t.name)).size, BUILTIN_THEMES.length);
  for (const t of BUILTIN_THEMES) assert.match(t.id, /^builtin:[a-z]+$/);
});
for (const t of BUILTIN_THEMES) {
  check(`${t.name}: sanitize round-trip is lossless (nothing rejected)`, () => {
    const { config, rejected } = sanitizeThemeConfig(builtinThemeConfig(t.id), { allowBuiltinId: true });
    assert.deepEqual(rejected, []);
    assert.deepEqual(config, t.config);
    assert.equal(config.builtinId, t.id);
  });
  check(`${t.name}: layout v3 valid (lyrics main + scripture verse/reference), no media`, () => {
    const layout = sanitizeThemeLayout(t.config.layout);
    assert.deepEqual(layout, t.config.layout);
    const lyr = layout!.slides.find((s) => s.role === "lyrics")!;
    assert.ok(lyr.objects.some((o) => o.kind === "text" && o.role === "main"));
    const sc = layout!.slides.find((s) => s.role === "scripture")!;
    assert.ok(sc.objects.some((o) => o.role === "verse"));
    assert.ok(sc.objects.some((o) => o.role === "reference"));
    const json = JSON.stringify(t.config);
    assert.ok(!/https?:|Url"/.test(json), "no media URLs");
  });
  check(`${t.name}: appearance non-null + valid`, () => {
    const a = themeConfigToAppearance(t.config);
    assert.ok(a);
    assert.ok(isValidThemeAppearance(a));
  });
}
check("builtinId validated against the list", () => {
  assert.equal(isBuiltinThemeId("builtin:dark"), true);
  assert.equal(isBuiltinThemeId("builtin:evil"), false);
  assert.equal(getBuiltinTheme("__proto__"), null);
  const allow = { allowBuiltinId: true };
  assert.deepEqual(sanitizeThemeConfig({ builtinId: "builtin:evil" }, allow).rejected, ["builtinId"]);
  assert.deepEqual(sanitizeThemeConfig({ builtinId: 5 }, allow).rejected, ["builtinId"]);
  assert.equal(sanitizeThemeConfig({ builtinId: "builtin:light" }, allow).config.builtinId, "builtin:light");
});
check("builtinId is STRIPPED by default (create/update/import) and by duplicate", () => {
  const r = sanitizeThemeConfig({ builtinId: "builtin:light", textColor: "#ffffff" });
  assert.equal(r.config.builtinId, undefined);
  assert.deepEqual(r.rejected, []);
  assert.equal(r.config.textColor, "#ffffff");
  assert.deepEqual(stripBuiltinId({ builtinId: "builtin:dark", bgColor: "#000000" }), { bgColor: "#000000" });
  const src = readFileSync(new URL("../src/lib/actions.ts", import.meta.url), "utf8");
  assert.equal(src.split("allowBuiltinId: true").length - 1, 1, "only materializeBuiltinTheme allows builtinId");
  assert.ok(/materializeBuiltinTheme[\s\S]*allowBuiltinId: true/.test(src));
  assert.ok(src.includes("config: stripBuiltinId(existing.config"), "duplicateTheme strips builtinId");
});
check("fonts are app-bundled web fonts (or Georgia, present on Windows + macOS) so wrapping matches on Windows", () => {
  const BUNDLED = new Set(["Inter", "Sora", "Plus Jakarta Sans", "Playfair Display", "Cormorant Garamond", "Fraunces", "Spectral", "Montserrat", "DM Serif Display", "Georgia"]);
  const json = JSON.stringify(BUILTIN_THEMES);
  assert.ok(!/Helvetica|Arial|Times New Roman/.test(json), "no OS-specific fonts");
  const fams = [...json.matchAll(/"fontFamily":"([^"]+)"/g)].map((m) => m[1]!.split(",")[0]!.trim());
  assert.ok(fams.length > 0);
  for (const f of fams) assert.ok(BUNDLED.has(f), `unbundled font ${f}`);
});
check("builtinThemeConfig returns an independent copy", () => {
  const c = builtinThemeConfig("builtin:default")!;
  c.textColor = "#ff0000";
  assert.equal(getBuiltinTheme("builtin:default")!.config.textColor, "#ffffff");
});

console.log(`\nbuiltin-themes: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
