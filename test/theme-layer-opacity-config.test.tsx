/**
 * Theme "See-through" (`layerOpacity`, plan round 3 item 1).
 *   - persisted via the theme whitelist (round-trip), clamped 0..1, junk rejected;
 *   - mapped onto appearance.layerOpacity ONLY when < 1 (every existing theme's
 *     appearance is unchanged);
 *   - the existing Opacity/Dim meaning is unchanged (bgOpacity ⇒ dim);
 *   - flag-off (legacy) output is byte-identical with or without it (golden).
 * Run: npx tsx test/theme-layer-opacity-config.test.tsx
 */
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { sanitizeThemeConfig, THEME_ALLOWED_KEYS, mergeThemeConfigPatch } from "../src/lib/theme-config";
import { themeConfigToAppearance } from "../src/lib/theme-appearance";
(globalThis as unknown as { React: typeof React }).React = React;

let pass = 0, fail = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}

async function main() {
  await check("layerOpacity is whitelisted and round-trips", () => {
    assert.ok((THEME_ALLOWED_KEYS as string[]).includes("layerOpacity"));
    const { config, rejected } = sanitizeThemeConfig({ bgColor: "#112233", layerOpacity: 0.4 });
    assert.deepEqual(rejected, []);
    assert.equal(config.layerOpacity, 0.4);
    const again = sanitizeThemeConfig(JSON.parse(JSON.stringify(config))).config;
    assert.deepEqual(again, config, "stable through JSON");
    const patched = sanitizeThemeConfig(mergeThemeConfigPatch(config, { layerOpacity: 0.7 })).config;
    assert.equal(patched.layerOpacity, 0.7, "field patch path");
    const cleared = sanitizeThemeConfig(mergeThemeConfigPatch(config, { layerOpacity: null })).config;
    assert.equal(cleared.layerOpacity, undefined, "null clears");
  });
  await check("layerOpacity validated: clamped 0..1, non-numbers rejected", () => {
    assert.equal(sanitizeThemeConfig({ layerOpacity: 7 }).config.layerOpacity, 1);
    assert.equal(sanitizeThemeConfig({ layerOpacity: -3 }).config.layerOpacity, 0);
    for (const bad of ["0.5", Number.NaN, {}, true]) {
      const r = sanitizeThemeConfig({ layerOpacity: bad });
      assert.equal(r.config.layerOpacity, undefined, `${String(bad)} not stored`);
      assert.ok(r.rejected.includes("layerOpacity"), `${String(bad)} reported rejected`);
    }
  });
  await check("appearance: only < 1 emits layerOpacity; default/absent/1 ⇒ key absent", () => {
    assert.equal(themeConfigToAppearance({ bgColor: "#aa0000", layerOpacity: 0.25 })!.layerOpacity, 0.25);
    assert.equal(themeConfigToAppearance({ bgColor: "#aa0000", layerOpacity: 0 })!.layerOpacity, 0);
    for (const cfg of [{ bgColor: "#aa0000" }, { bgColor: "#aa0000", layerOpacity: 1 }, { bgColor: "#aa0000", layerOpacity: "x" }]) {
      const a = themeConfigToAppearance(cfg)!;
      assert.ok(!("layerOpacity" in a), `no key for ${JSON.stringify(cfg)}`);
      assert.deepEqual(a, themeConfigToAppearance({ bgColor: "#aa0000" }), "identical to a theme without it");
    }
    assert.equal(themeConfigToAppearance({ layerOpacity: 0.5 }), null, "see-through alone is not a theme");
  });
  await check("dim meaning unchanged: bgOpacity ⇒ dim, dim wins, independent of layerOpacity", () => {
    const a = themeConfigToAppearance({ bgColor: "#aa0000", bgOpacity: 0.6, layerOpacity: 0.5 })!;
    assert.ok(Math.abs((a.dim ?? 0) - 0.4) < 1e-9);
    assert.equal(a.layerOpacity, 0.5);
    const b = themeConfigToAppearance({ bgColor: "#aa0000", dim: 0.2, bgOpacity: 0.6 })!;
    assert.equal(b.dim, 0.2);
    assert.equal(b.layerOpacity, undefined);
  });
  await check("flag-off golden: legacy SlideRenderer + OutputCompositor markup identical with/without layerOpacity", async () => {
    const { SlideRenderer } = await import("../src/components/live/SlideRenderer");
    const { OutputCompositor } = await import("../src/components/live/OutputCompositor");
    const base = themeConfigToAppearance({ bgType: "solid", bgColor: "#aa0000", textColor: "#ffffff" })!;
    const seeThrough = themeConfigToAppearance({ bgType: "solid", bgColor: "#aa0000", textColor: "#ffffff", layerOpacity: 0.3 })!;
    assert.equal(seeThrough.layerOpacity, 0.3);
    const slide = { kind: "text" as const, text: "Amazing grace" };
    assert.equal(
      renderToStaticMarkup(<SlideRenderer slide={slide} appearance={seeThrough} />),
      renderToStaticMarkup(<SlideRenderer slide={slide} appearance={base} />),
    );
    const bg = { type: "image" as const, imageUrl: "https://cdn.example.com/a.png" };
    assert.equal(
      renderToStaticMarkup(<OutputCompositor mode="live" slide={slide} appearance={seeThrough} background={bg} />),
      renderToStaticMarkup(<OutputCompositor mode="live" slide={slide} appearance={base} background={bg} />),
    );
    // …and under V3 it IS the theme layer's CSS opacity.
    const v3 = renderToStaticMarkup(<OutputCompositor mode="live" slide={slide} appearance={seeThrough} background={bg} layerOrderV3 />);
    assert.match(v3, /opacity:\s*0\.3/);
  });
  await check("both live theme editors expose the See-through slider (distinct from Dim/Opacity)", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["src/components/operator/pro/ThemeEditorTab.tsx", "src/components/library/ThemesManager.tsx"]) {
      const s = readFileSync(f, "utf8");
      assert.match(s, /See-through/, f);
      assert.match(s, /layerOpacity: 1 - Number\(e\.target\.value\) \/ 100/, `${f} writes layerOpacity`);
    }
  });
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
