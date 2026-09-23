/**
 * REGRESSION (2026-09-22): a theme's scripture BAND must survive being SAVED.
 *
 * `theme-scripture.ts` has read `scriptureLayout` / `scriptureBand` since the
 * 0.1.490 "themes can now use the Third band" ship, and `theme-carries-band.test.ts`
 * proved the READ path works — but it fed `themeScriptureOptions` a hand-built
 * object and never went through `sanitizeThemeConfig`. Neither key was in
 * THEME_ALLOWED_KEYS, so EVERY writer (updateTheme / createTheme / importTheme /
 * duplicateTheme funnels through the sanitizer) silently stripped them and the
 * ThemeEditorTab "Full screen / Third band" control did nothing at all.
 *
 * These tests close the loop: sanitize FIRST, then read, exactly as production does.
 * Run: npx tsx test/theme-band-persist.test.ts
 */
import assert from "node:assert/strict";
import { sanitizeThemeConfig } from "../src/lib/theme-config";
import { themeScriptureOptions, designFromThemeScripture } from "../src/lib/theme-scripture";
import { DEFAULT_SCRIPTURE_DESIGN, BAND_DEFAULT } from "../src/lib/scripture-design";

let pass = 0, fail = 0;
const check = (n: string, fn: () => void) => { try { fn(); console.log(`  PASS  ${n}`); pass++; } catch (e) { console.error(`  FAIL  ${n}\n        ${(e as Error).message}`); fail++; } };
/** The production round-trip: what the operator sends -> what the DB would hold. */
const saved = (cfg: Record<string, unknown>) => sanitizeThemeConfig(cfg).config as Record<string, unknown>;
const designAfterSave = (cfg: Record<string, unknown>) => {
  const o = themeScriptureOptions(saved(cfg));
  return o ? designFromThemeScripture(o, DEFAULT_SCRIPTURE_DESIGN) : null;
};

console.log("the band survives a save:");
check("scriptureLayout is PERSISTED, not rejected", () => {
  const { config, rejected } = sanitizeThemeConfig({ scriptureLayout: "lowerThird" });
  assert.equal(config.scriptureLayout, "lowerThird", "stripped by the sanitizer — the 0.1.490 feature cannot persist");
  assert.ok(!rejected.includes("scriptureLayout"), `rejected: ${rejected.join(",")}`);
});
check("scriptureBand is PERSISTED and clamped by sanitizeBandStyle", () => {
  const { config } = sanitizeThemeConfig({
    scriptureLayout: "lowerThird",
    scriptureBand: { mode: "solid", color: "#112233", opacity: 0.5, position: "mid", heightPct: 24, fontScale: 1.2, refScale: 1.5, widthPct: 70 },
  });
  assert.ok(config.scriptureBand, "band stripped on save");
  assert.equal(config.scriptureBand!.color, "#112233");
  assert.equal(config.scriptureBand!.position, "mid");
  assert.equal(config.scriptureBand!.heightPct, 24);
});
check("a saved theme still yields a lowerThird design end-to-end", () => {
  const d = designAfterSave({ scriptureLayout: "lowerThird" })!;
  assert.equal(d.layout, "lowerThird");
  assert.deepEqual(d.band, BAND_DEFAULT, "no band spec -> the default band");
});
check("a saved theme carries its OWN band through to the design", () => {
  const d = designAfterSave({ scriptureLayout: "lowerThird", scriptureBand: { mode: "gradient", color: "#101010", color2: "#202020", angle: 90, opacity: 0.8, position: "lower", heightPct: 30, fontScale: 1.1, refScale: 1, widthPct: 88 } })!;
  assert.equal(d.layout, "lowerThird");
  assert.equal(d.band.mode, "gradient");
  assert.equal(d.band.color, "#101010");
  assert.equal(d.band.heightPct, 30);
});

console.log("\nno regression for everything else:");
check("an unknown scripture layout is REJECTED, never written through", () => {
  const { config, rejected } = sanitizeThemeConfig({ scriptureLayout: "sideways" });
  assert.equal(config.scriptureLayout, undefined);
  assert.ok(rejected.includes("scriptureLayout"));
});
check("a non-object band is REJECTED", () => {
  for (const bad of ["x", 5, true, []]) {
    const { config, rejected } = sanitizeThemeConfig({ scriptureBand: bad });
    assert.equal(config.scriptureBand, undefined, `accepted ${JSON.stringify(bad)}`);
    assert.ok(rejected.includes("scriptureBand"));
  }
});
check("a CORRUPTED band is clamped to valid values, never emitted raw", () => {
  const { config } = sanitizeThemeConfig({ scriptureBand: { mode: "nonsense", color: "not-a-hex", opacity: 99, heightPct: -5, position: "sideways" } });
  const b = config.scriptureBand!;
  assert.ok(["none", "solid", "gradient"].includes(b.mode));
  assert.match(b.color, /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
  assert.ok(b.opacity >= 0 && b.opacity <= 1, `opacity ${b.opacity}`);
  assert.ok(b.heightPct > 0, `heightPct ${b.heightPct}`);
  assert.ok(["upper", "mid", "lower"].includes(b.position));
});
check("a theme that says nothing about scripture is STILL opted out", () => {
  assert.equal(designAfterSave({ fontFamily: "Inter" }), null, "an unrelated theme must not suddenly produce a band");
});
check("a theme saved WITHOUT these keys is byte-identical to before the fix", () => {
  const before = { fontFamily: "Inter", fontSizePx: 90, bgColor: "#000000", scriptureShowReference: true };
  assert.deepEqual(saved(before), before, "an existing theme must round-trip unchanged");
});
check("fullscreen persists too (an explicit opt-OUT of the band)", () => {
  const { config, rejected } = sanitizeThemeConfig({ scriptureLayout: "fullscreen" });
  assert.equal(config.scriptureLayout, "fullscreen");
  assert.ok(!rejected.includes("scriptureLayout"));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
