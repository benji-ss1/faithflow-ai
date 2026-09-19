/**
 * Scripture lower-third: INDEPENDENT verse vs reference sizing + a width control
 * (2026-09-19 owner request — "the scripture text should be able to be the same size as
 * JOHN 3:16 (NIV)", plus separate sizing and more width control).
 *
 * The invariant that matters most: a church that never touches the two new sliders must
 * get a byte-identical wire, slide identity and renderer geometry. Run:
 *   npx tsx test/scripture-size-width.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BAND_DEFAULT, DEFAULT_SCRIPTURE_DESIGN, sanitizeBandStyle, sanitizeScriptureDesign, type BandStyle } from "../src/lib/scripture-design";
import { bandWireFromDesign, scriptureLowerThirdPayload } from "../src/components/operator/scripture/scriptureStyle";
import { slideDesignSig, sanitizeOutputState } from "../src/lib/broadcast";
import { refScaleOf, textWidthOf } from "../src/lib/band-media";
let pass = 0, fail = 0;
const check = (n: string, fn: () => void) => { try { fn(); console.log(`  PASS  ${n}`); pass++; } catch (e) { console.error(`  FAIL  ${n}\n        ${(e as Error).message}`); fail++; } };
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const lt = (band: Partial<BandStyle> = {}) => ({ ...DEFAULT_SCRIPTURE_DESIGN, layout: "lowerThird" as const, band: { ...BAND_DEFAULT, ...band } });

console.log("no regression — an untouched church is byte-identical:");
check("default design wire carries NO refScale / widthPct", () => {
  const w = bandWireFromDesign(lt())!;
  assert.equal(w.refScale, undefined);
  assert.equal(w.widthPct, undefined);
  assert.deepEqual(Object.keys(w).sort(), ["color", "fontScale", "heightPct", "opacity", "topPct"]);
});
check("default slide identity string is unchanged (no fade-pulse, no re-send)", () => {
  const sig = slideDesignSig(scriptureLowerThirdPayload("v", "John 3:16", "KJV", lt()) as never);
  assert.ok(!sig.includes(",r"), `identity gained a field: ${sig}`);
  // Golden: verified byte-identical to origin/main on this exact input (2026-09-19).
  assert.equal(sig, "||lt68,30,1,#1c1c22,,,0.72,");
});
check("a design saved before these controls existed loads with the defaults", () => {
  const old = { layout: "lowerThird", band: { mode: "solid", color: "#000000", opacity: 0.7, position: "lower", offsetY: 0, heightPct: 30, fontScale: 1 } };
  const d = sanitizeScriptureDesign(old)!;
  assert.equal(d.band.refScale, 1);
  assert.equal(d.band.widthPct, 88);
  assert.equal(bandWireFromDesign(d)!.refScale, undefined);
});
check("renderer helpers return today's numbers when the wire omits the fields", () => {
  assert.equal(refScaleOf(undefined), 1);
  assert.equal(textWidthOf(undefined), 88);
});

console.log("independent sizing:");
check("reference size travels on the wire only once changed", () => {
  assert.equal(bandWireFromDesign(lt({ refScale: 1.8 }))!.refScale, 1.8);
  assert.equal(bandWireFromDesign(lt({ refScale: 1 }))!.refScale, undefined);
});
check("verse size and reference size are separate levers", () => {
  const w = bandWireFromDesign(lt({ fontScale: 0.4, refScale: 2 }))!;
  assert.equal(w.fontScale, 0.4);
  assert.equal(w.refScale, 2);
});
check("verse can now be dialled down to reference size (floor 0.5 -> 0.3)", () => {
  assert.equal(sanitizeBandStyle({ ...BAND_DEFAULT, fontScale: 0.3 }).fontScale, 0.3);
  assert.equal(sanitizeBandStyle({ ...BAND_DEFAULT, fontScale: 0.05 }).fontScale, 0.3);
});
check("changing either size changes the slide identity (the edit reaches the projector)", () => {
  const base = slideDesignSig(scriptureLowerThirdPayload("v", "John 3:16", "KJV", lt()) as never);
  for (const b of [{ refScale: 1.5 }, { widthPct: 70 }, { fontScale: 1.5 }]) {
    assert.notEqual(slideDesignSig(scriptureLowerThirdPayload("v", "John 3:16", "KJV", lt(b)) as never), base, JSON.stringify(b));
  }
});

console.log("width:");
check("width travels only once changed, and is a centred % of the canvas", () => {
  assert.equal(bandWireFromDesign(lt({ widthPct: 60 }))!.widthPct, 60);
  assert.equal(bandWireFromDesign(lt({ widthPct: 88 }))!.widthPct, undefined);
  assert.equal(textWidthOf(60), 60);
});
check("width is clamped to a sane band (50..100 saved, 40..100 accepted on the wire)", () => {
  assert.equal(sanitizeBandStyle({ ...BAND_DEFAULT, widthPct: 5 }).widthPct, 50);
  assert.equal(sanitizeBandStyle({ ...BAND_DEFAULT, widthPct: 400 }).widthPct, 100);
  assert.equal(textWidthOf(1), 40);
  assert.equal(textWidthOf(400), 100);
});

console.log("hostile input (a spoofed frame must never black out the projector):");
const frame = (band: Record<string, unknown>): unknown => ({
  live: { kind: "text", text: "v", reference: "John 3:16", scriptureLayout: "lowerThird", scriptureBand: band },
  next: null, blank: false, ts: 1, revision: 1, aspectRatio: "16:9",
});
check("out-of-range refScale / widthPct never reach the renderer (band dropped, verse still shows)", () => {
  for (const bad of [{ refScale: 99 }, { refScale: -1 }, { refScale: "2" }, { widthPct: 500 }, { widthPct: 0 }, { widthPct: null }]) {
    const out = sanitizeOutputState(frame({ topPct: 70, heightPct: 30, ...bad })) as { live: Record<string, unknown> } | null;
    assert.ok(out, `frame should still be projectable: ${JSON.stringify(bad)}`);
    assert.equal(out!.live.scriptureBand, undefined, `bad band must be dropped: ${JSON.stringify(bad)}`);
    assert.equal(out!.live.text, "v", "the verse itself survives");
  }
});
check("in-range values pass the validator and keep the band", () => {
  const out = sanitizeOutputState(frame({ topPct: 70, heightPct: 30, refScale: 2.5, widthPct: 55 })) as { live: Record<string, unknown> } | null;
  assert.ok(out);
  assert.deepEqual(out!.live.scriptureBand, { topPct: 70, heightPct: 30, refScale: 2.5, widthPct: 55 });
});
check("NaN / Infinity fall back to the defaults, never to a broken layout", () => {
  assert.equal(sanitizeBandStyle({ ...BAND_DEFAULT, refScale: NaN }).refScale, 1);
  assert.equal(sanitizeBandStyle({ ...BAND_DEFAULT, widthPct: Infinity }).widthPct, 88);
  assert.equal(refScaleOf(NaN), 1);
  assert.equal(textWidthOf(NaN), 88);
});

console.log("renderer wiring:");
const r = read("src/components/live/SlideRenderer.tsx");
check("both the verse box and the reference box use the SAME width lever", () => {
  assert.equal((r.match(/left: `\$\{textLeft\}%`, width: `\$\{textW\}%`/g) ?? []).length, 2);
  assert.doesNotMatch(r, /left: "6%", width: "88%"/);
});
check("the reference row grows so a bigger reference can never overlap the verse", () => {
  assert.match(r, /const refH = Math\.min\(bandH \* 0\.5, Math\.max\(bandH \* 0\.20/);
});
check("reference px folds in refScale alongside the existing REF control", () => {
  assert.match(r, /\(referenceScale \?\? 1\) \* refScaleOf\(band\?\.refScale\)/);
});
check("at default scale the reference row is exactly the old 20% of the band", () => {
  for (const bandH of [16, 24, 30, 48]) {
    const refPx = Math.round((bandH / 100) * 1080 * 0.11);
    assert.equal(Math.min(bandH * 0.5, Math.max(bandH * 0.20, (refPx / 1080) * 100 * 1.15)), bandH * 0.20, `bandH=${bandH}`);
  }
});

console.log("editor:");
const ed = read("src/components/operator/scripture/ScriptureSlideEditor.tsx");
check("the editor offers Verse size, Reference size and Width", () => {
  for (const label of ["Verse size", "Reference size", "Width"]) assert.ok(ed.includes(`<Row label="${label}">`), label);
});
check("the sliders' ranges match the sanitizer's", () => {
  assert.match(ed, /min=\{0\.3\} max=\{2\}[^\n]*band\.fontScale/);
  assert.match(ed, /min=\{0\.5\} max=\{3\}[^\n]*band\.refScale/);
  assert.match(ed, /min=\{50\} max=\{100\}[^\n]*band\.widthPct/);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
