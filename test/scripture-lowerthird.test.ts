/**
 * Lower-third scripture mode (Christ Embassy pilot, 2026-09-03).
 *
 * A verse can project as a big caption in a bottom BAND (opaque over the theme,
 * or transparent over the church's own feed) instead of the full-screen slide.
 * The layout is a per-church preset: fullscreen keeps the styled drag-objects
 * path; lowerThird takes a dedicated PLAIN payload (scriptureLayout:"lowerThird")
 * that the renderer confines + auto-fits.
 *
 * Verifies the pure builders + wire identity:
 *   - bandWireFromDesign carries paint only, and nothing for fullscreen / "none"
 *   - scriptureLowerThirdPayload marks the layout, keeps the reference, adds NO objects
 *   - scriptureSlidePayload branches on layout
 *   - styleScriptureSlide leaves an already-lower-third slide untouched
 *   - slideOutputIdentity folds in layout + band (band edit transitions; same
 *     verse+band is stable → no rule-7 pulse; lowerThird ≠ fullscreen)
 *
 * Run: npx tsx test/scripture-lowerthird.test.ts
 * (No window in node → loadScriptureStyle returns the DEFAULT fullscreen design.)
 */
import assert from "node:assert/strict";
import {
  bandWireFromDesign, scriptureLowerThirdPayload, scriptureSlidePayload, styleScriptureSlide,
  DEFAULT_SCRIPTURE_DESIGN, BAND_DEFAULT, type ScriptureDesign,
} from "../src/components/operator/scripture/scriptureStyle";
import { slideOutputIdentity, type SlidePayload } from "../src/lib/broadcast";

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : e}`); }
}

const lt = (over: Partial<ScriptureDesign["band"]> = {}, layout: ScriptureDesign["layout"] = "lowerThird"): ScriptureDesign => ({
  ...DEFAULT_SCRIPTURE_DESIGN,
  layout,
  band: { ...BAND_DEFAULT, ...over },
});

console.log("bandWireFromDesign — paint only, nothing when it shouldn't paint:");
test("fullscreen layout → undefined (band never paints outside lower-third)", () => {
  assert.equal(bandWireFromDesign(lt({}, "fullscreen")), undefined);
});
test("lower-third + mode none → undefined (transparent lower-third)", () => {
  assert.equal(bandWireFromDesign(lt({ mode: "none" })), undefined);
});
test("solid → color + opacity, no color2", () => {
  const w = bandWireFromDesign(lt({ mode: "solid", color: "#000000", opacity: 0.72 }));
  assert.deepEqual(w, { color: "#000000", opacity: 0.72 });
});
test("gradient → color, color2, angle, opacity", () => {
  const w = bandWireFromDesign(lt({ mode: "gradient", color: "#101010", color2: "#303030", angle: 180, opacity: 0.8 }));
  assert.deepEqual(w, { color: "#101010", color2: "#303030", angle: 180, opacity: 0.8 });
});

console.log("scriptureLowerThirdPayload — plain payload, no objects:");
test("marks layout, keeps reference, adds a band, NO objects", () => {
  const p = scriptureLowerThirdPayload("For God so loved the world", "John 3:16", "KJV", lt());
  assert.equal(p.kind, "text");
  if (p.kind !== "text") return;
  assert.equal(p.scriptureLayout, "lowerThird");
  assert.equal(p.text, "For God so loved the world");
  assert.equal(p.reference, "John 3:16 (KJV)");
  assert.ok(p.scriptureBand && p.scriptureBand.color === "#000000");
  assert.ok(!p.objects || p.objects.length === 0, "lower-third must NOT carry drag objects");
});
test("mode none → layout marked but NO band (verse floats)", () => {
  const p = scriptureLowerThirdPayload("Jesus wept", "John 11:35", "KJV", lt({ mode: "none" }));
  if (p.kind !== "text") return assert.fail();
  assert.equal(p.scriptureLayout, "lowerThird");
  assert.equal(p.scriptureBand, undefined);
});
test("empty reference → no reference field (Show toggle off)", () => {
  const p = scriptureLowerThirdPayload("Jesus wept", "", "KJV", lt());
  if (p.kind !== "text") return assert.fail();
  assert.equal(p.reference, undefined);
});

console.log("scriptureSlidePayload — branches on layout:");
test("lowerThird design → lower-third payload (no objects)", () => {
  const p = scriptureSlidePayload("v", "John 3:16", "KJV", lt());
  if (p.kind !== "text") return assert.fail();
  assert.equal(p.scriptureLayout, "lowerThird");
  assert.ok(!p.objects || p.objects.length === 0);
});
test("fullscreen design → styled objects (no scriptureLayout)", () => {
  const p = scriptureSlidePayload("v", "John 3:16", "KJV", DEFAULT_SCRIPTURE_DESIGN);
  if (p.kind !== "text") return assert.fail();
  assert.equal(p.scriptureLayout, undefined);
  assert.ok(p.objects && p.objects.length > 0, "fullscreen still carries drag objects");
});

console.log("styleScriptureSlide — already-lower-third is untouched:");
test("a slide already marked lowerThird passes through unchanged", () => {
  const already: SlidePayload = { kind: "text", text: "x", reference: "John 3:16 (KJV)", scriptureLayout: "lowerThird" };
  assert.strictEqual(styleScriptureSlide(already, "church-1"), already);
});

console.log("slideOutputIdentity — folds in layout + band (rule-7 pulse invariant):");
test("same verse + same band → identical identity (re-fire never pulses)", () => {
  const a = scriptureLowerThirdPayload("For God so loved", "John 3:16", "KJV", lt());
  const b = scriptureLowerThirdPayload("For God so loved", "John 3:16", "KJV", lt());
  assert.equal(slideOutputIdentity(a), slideOutputIdentity(b));
});
test("band opacity change → different identity (a band edit transitions)", () => {
  const a = scriptureLowerThirdPayload("v", "John 3:16", "KJV", lt({ opacity: 0.72 }));
  const b = scriptureLowerThirdPayload("v", "John 3:16", "KJV", lt({ opacity: 0.4 }));
  assert.notEqual(slideOutputIdentity(a), slideOutputIdentity(b));
});
test("lower-third vs fullscreen same verse → different identity", () => {
  const ltP = scriptureSlidePayload("v", "John 3:16", "KJV", lt());
  const fsP = scriptureSlidePayload("v", "John 3:16", "KJV", DEFAULT_SCRIPTURE_DESIGN);
  assert.notEqual(slideOutputIdentity(ltP), slideOutputIdentity(fsP));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
