/**
 * "Reference same size as the verse" — ProPresenter's "Reference: With Verse",
 * as an OPT-IN option (user directive 2026-09-25).
 *
 * Explicitly NOT the default: on a full projector screen most churches do not
 * want the reference as large as the verse. It is mainly wanted on the third
 * band, and it is a preference either way. So OFF must be byte-identical to how
 * the app behaved before the option existed.
 *
 * Applied at DESIGN -> PAYLOAD time, so there is no renderer change and no wire
 * schema change:
 *   - full screen: the reference text object takes the verse's fontSize
 *   - third band: the renderer sizes the verse with factor 0.22 and the
 *     reference with 0.11, so parity is refScale = 2 x fontScale
 *
 * Run: npx tsx test/scripture-ref-match-verse.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_SCRIPTURE_DESIGN, sanitizeScriptureDesign, BAND_DEFAULT, type ScriptureDesign,
} from "../src/lib/scripture-design";
import { bandWireFromDesign, scriptureSlidePayload } from "../src/components/operator/scripture/scriptureStyle";
import { bandVersePx } from "../src/lib/band-media";

let pass = 0, fail = 0;
const check = (n: string, fn: () => void) => { try { fn(); console.log(`  PASS  ${n}`); pass++; } catch (e) { console.error(`  FAIL  ${n}\n        ${(e as Error).message}`); fail++; } };
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const design = (over: Partial<ScriptureDesign> = {}, refOver: Record<string, unknown> = {}): ScriptureDesign => ({
  ...DEFAULT_SCRIPTURE_DESIGN, ...over,
  reference: { ...DEFAULT_SCRIPTURE_DESIGN.reference, ...refOver },
  band: { ...BAND_DEFAULT, ...(over.band ?? {}) },
});
const refSizeOf = (p: unknown) => {
  const objs = (p as { objects?: Array<Record<string, unknown>> }).objects ?? [];
  return (objs[1]?.fontSize as number | undefined);
};
const verseSizeOf = (p: unknown) => {
  const objs = (p as { objects?: Array<Record<string, unknown>> }).objects ?? [];
  return (objs[0]?.fontSize as number | undefined);
};

console.log("OFF is the default, and is a provable no-op:");
check("the shipped default is OFF", () => {
  assert.equal(DEFAULT_SCRIPTURE_DESIGN.reference.matchVerseSize, false,
    "this must never default ON — it changes live output for every church");
});
check("full screen OFF: the reference keeps its own smaller size", () => {
  const p = scriptureSlidePayload("For God so loved the world", "John 3:16", "KJV", design());
  assert.equal(verseSizeOf(p), DEFAULT_SCRIPTURE_DESIGN.verse.fontSize);
  assert.equal(refSizeOf(p), DEFAULT_SCRIPTURE_DESIGN.reference.fontSize);
  assert.notEqual(refSizeOf(p), verseSizeOf(p), "OFF must not match sizes");
});
check("band OFF: the wire is byte-identical to before the option existed", () => {
  const w = bandWireFromDesign(design({ layout: "lowerThird" }));
  assert.equal(w?.refScale, undefined,
    "refScale is emitted only when changed from default — an untouched church's wire must not grow a field");
});

console.log("\nON does what it says:");
check("full screen ON: the reference is drawn at the verse's size", () => {
  const p = scriptureSlidePayload("For God so loved the world", "John 3:16", "KJV", design({}, { matchVerseSize: true }));
  assert.equal(refSizeOf(p), verseSizeOf(p), "reference did not take the verse's size");
});
check("full screen ON: only the SIZE changes, other reference styling is kept", () => {
  const d = design({}, { matchVerseSize: true, color: "#ffcc00", align: "left" as const });
  const p = scriptureSlidePayload("v", "John 3:16", "KJV", d);
  const objs = (p as { objects?: Array<Record<string, unknown>> }).objects ?? [];
  assert.equal(objs[1]?.color, "#ffcc00", "reference colour was overwritten");
  assert.equal(objs[1]?.align, "left", "reference alignment was overwritten");
});
check("band ON: refScale = 2 x fontScale, which is real parity in px", () => {
  for (const fontScale of [0.5, 1, 1.4]) {
    const w = bandWireFromDesign(design({ layout: "lowerThird", band: { ...BAND_DEFAULT, fontScale } }, { matchVerseSize: true }));
    const want = fontScale * 2;
    // The wire OMITS refScale when it equals the default (1) — an untouched
    // church's output identity must not grow a field. The renderer then uses 1,
    // so the effective value is what matters, not whether the key is present.
    const effective = w?.refScale ?? BAND_DEFAULT.refScale;
    assert.equal(effective, want, `fontScale ${fontScale}: effective refScale`);
    // ...and prove parity in PIXELS using the renderer's own factors.
    const bandH = BAND_DEFAULT.heightPct;
    const versePx = bandVersePx(bandH, fontScale, 1);
    const refPx = Math.round((bandH / 100) * 1080 * 0.11 * effective);
    assert.ok(Math.abs(versePx - refPx) <= 1, `fontScale ${fontScale}: verse ${versePx}px vs ref ${refPx}px`);
  }
});
check("band ON: a large verse scale SATURATES instead of emitting an invalid wire", () => {
  const w = bandWireFromDesign(design({ layout: "lowerThird", band: { ...BAND_DEFAULT, fontScale: 2 } }, { matchVerseSize: true }));
  assert.equal(w?.refScale, 3, "must clamp to the band's refScale max, not emit 4");
});

console.log("\nit saves and comes back:");
check("the flag survives a save/load round trip", () => {
  const saved = JSON.parse(JSON.stringify(design({}, { matchVerseSize: true })));
  assert.equal(sanitizeScriptureDesign(saved)!.reference.matchVerseSize, true);
});
check("a non-boolean is rejected, falling back to OFF", () => {
  const bad = JSON.parse(JSON.stringify(design()));
  (bad.reference as Record<string, unknown>).matchVerseSize = "yes";
  assert.equal(sanitizeScriptureDesign(bad)!.reference.matchVerseSize, false);
});
check("an OLD saved style with no such key loads as OFF", () => {
  const old = JSON.parse(JSON.stringify(design()));
  delete (old.reference as Record<string, unknown>).matchVerseSize;
  assert.equal(sanitizeScriptureDesign(old)!.reference.matchVerseSize, false,
    "an existing church must not silently gain the option");
});

console.log("\nthe UI:");
check("the control sits at the TOP of the editor, above Layout", () => {
  const src = read("../src/components/operator/scripture/ScriptureSlideEditor.tsx");
  const ref = src.indexOf('<Section label="Reference size">');
  const layout = src.indexOf('<Section label="Layout">');
  assert.ok(ref > 0, "the Reference size section is missing");
  assert.ok(ref < layout, "it must come BEFORE Layout — the operator asked for it at the top");
});
check("it says plainly which state it is in", () => {
  const src = read("../src/components/operator/scripture/ScriptureSlideEditor.tsx");
  assert.match(src, /Same size as the verse/);
  assert.match(src, /Smaller than the verse/);
});
check("the editor saves it, and the band PREVIEW honours it", () => {
  const src = read("../src/components/operator/scripture/ScriptureSlideEditor.tsx");
  assert.match(src, /d\.reference\.matchVerseSize = matchVerseSize;/, "not saved with the Scripture Style");
  assert.match(src, /show: showRef, matchVerseSize \}/, "the band preview ignores it, so the preview would lie");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
