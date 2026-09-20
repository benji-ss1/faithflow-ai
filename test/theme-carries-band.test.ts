/**
 * A THEME can now carry the lower-third band (owner request 2026-09-20). Until now
 * `designFromThemeScripture` always returned `layout: "fullscreen"`, so the only way to
 * get a band was to save a church Scripture Style — a theme alone could never produce one.
 *
 * Precedence is unchanged: a saved Scripture Style still wins over the theme
 * (styleScriptureSlide), and a theme that says nothing about scripture is still opted OUT.
 * Run: npx tsx test/theme-carries-band.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { themeScriptureOptions, designFromThemeScripture } from "../src/lib/theme-scripture";
import { DEFAULT_SCRIPTURE_DESIGN, BAND_DEFAULT } from "../src/lib/scripture-design";
import { themeScripturePayload } from "../src/components/operator/scripture/scriptureStyle";
import { sanitizeOutputState } from "../src/lib/broadcast";
let pass = 0, fail = 0;
const check = (n: string, fn: () => void) => { try { fn(); console.log(`  PASS  ${n}`); pass++; } catch (e) { console.error(`  FAIL  ${n}\n        ${(e as Error).message}`); fail++; } };
const opts = (cfg: Record<string, unknown>) => themeScriptureOptions(cfg);
const design = (cfg: Record<string, unknown>) => { const o = opts(cfg); return o ? designFromThemeScripture(o, DEFAULT_SCRIPTURE_DESIGN) : null; };

console.log("a theme can now ask for the band:");
check("scriptureLayout:lowerThird opts the theme in and yields a lowerThird design", () => {
  const d = design({ scriptureLayout: "lowerThird" })!;
  assert.equal(d.layout, "lowerThird");
  assert.deepEqual(d.band, BAND_DEFAULT, "no band spec -> the default band");
});
check("the theme's own band settings come through", () => {
  const d = design({ scriptureLayout: "lowerThird", scriptureBand: { mode: "solid", color: "#112233", opacity: 0.5, position: "mid", heightPct: 24, fontScale: 1.2, refScale: 1.5, widthPct: 70 } })!;
  assert.equal(d.band.color, "#112233");
  assert.equal(d.band.position, "mid");
  assert.equal(d.band.heightPct, 24);
  assert.equal(d.band.fontScale, 1.2);
  assert.equal(d.band.refScale, 1.5);
  assert.equal(d.band.widthPct, 70);
});
check("the reference toggles still apply to a themed band", () => {
  const d = design({ scriptureLayout: "lowerThird", scriptureShowReference: false })!;
  assert.equal(d.reference.show, false);
  const e = design({ scriptureLayout: "lowerThird", scriptureTranslationVisible: false })!;
  assert.equal(e.reference.showTranslation, false);
});
check("a themed band produces the SAME plain band payload a saved style produces", () => {
  const p = themeScripturePayload("For God so loved", "John 3:16", "KJV", opts({ scriptureLayout: "lowerThird" })!) as Record<string, unknown>;
  assert.equal(p.kind, "text");
  assert.equal(p.scriptureLayout, "lowerThird");
  assert.equal(p.reference, "John 3:16 (KJV)");
  assert.ok(p.scriptureBand, "carries the band on the wire");
  assert.equal(p.objects, undefined, "never the designed-objects path");
});
check("the themed band survives the output validator", () => {
  const live = themeScripturePayload("v", "John 3:16", "KJV", opts({ scriptureLayout: "lowerThird", scriptureBand: { mode: "gradient", color: "#000000", color2: "#222222", angle: 180, opacity: 0.8, heightPct: 40 } })!);
  const out = sanitizeOutputState({ live, next: null, blank: false, ts: 1, revision: 1, aspectRatio: "16:9" }) as { live: Record<string, unknown> } | null;
  assert.ok(out, "frame accepted");
  assert.ok(out!.live.scriptureBand, "band kept");
});

console.log("hostile / corrupt theme bands are clamped, never emitted raw:");
check("out-of-range band values are clamped by the SAME sanitizer a saved style uses", () => {
  const d = design({ scriptureLayout: "lowerThird", scriptureBand: { heightPct: 900, opacity: 9, fontScale: -4, color: "red;--x:url(evil)", position: "sideways", mode: "weird" } })!;
  assert.ok(d.band.heightPct <= 60 && d.band.heightPct >= 10, `heightPct=${d.band.heightPct}`);
  assert.ok(d.band.opacity >= 0 && d.band.opacity <= 1);
  assert.ok(d.band.fontScale >= 0.3);
  assert.equal(d.band.color, BAND_DEFAULT.color, "CSS-injection colour -> default");
  assert.equal(d.band.position, BAND_DEFAULT.position);
  assert.equal(d.band.mode, BAND_DEFAULT.mode);
});
check("a non-object band is ignored and the default band is used", () => {
  for (const b of [null, "x", 5, []]) {
    const d = design({ scriptureLayout: "lowerThird", scriptureBand: b })!;
    assert.deepEqual(d.band, BAND_DEFAULT, JSON.stringify(b));
  }
});

console.log("no regression — themes that say nothing are untouched:");
check("a theme with no scripture settings is still opted OUT entirely", () => {
  assert.equal(opts({}), null);
  assert.equal(opts({ bgType: "solid", bgColor: "#000" }), null);
});
check("an existing full-screen scripture theme still yields fullscreen", () => {
  const d = design({ scriptureShowReference: false })!;
  assert.equal(d.layout, "fullscreen");
  const e = design({ scriptureReferencePosition: "below" })!;
  assert.equal(e.layout, "fullscreen");
});
check("scriptureLayout:'fullscreen' (or junk) does NOT opt a theme in on its own", () => {
  assert.equal(opts({ scriptureLayout: "fullscreen" }), null);
  assert.equal(opts({ scriptureLayout: "banana" }), null);
});
check("a full-screen theme still takes the designed-objects path", () => {
  const p = themeScripturePayload("v", "John 3:16", "KJV", opts({ scriptureShowReference: true, scriptureReferencePosition: "below" })!) as Record<string, unknown>;
  assert.equal(p.scriptureLayout, undefined);
  assert.ok(Array.isArray(p.objects), "fullscreen keeps its positioned objects");
});
check("a saved church Scripture Style still wins over the theme", () => {
  const src = readFileSync(new URL("../src/components/operator/scripture/scriptureStyle.ts", import.meta.url), "utf8");
  assert.match(src, /if \(themeOpts && !hasSavedScriptureStyle\(churchId\)\) return themeScripturePayload/);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
