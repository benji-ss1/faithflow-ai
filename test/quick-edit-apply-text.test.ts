/**
 * Quick Edit "works no matter the design" (2026-08-25). applyTextToSlide swaps a
 * slide's text while PRESERVING its designed layout — used by Quick Edit's
 * save-and-push so the projector renders the church's styling, not a plain-text
 * default. Verifies: plain text updates; a designed slide keeps geometry/style
 * and only the first text object's words change; non-text objects + non-text
 * slides are untouched.
 *
 * Run: npx tsx test/quick-edit-apply-text.test.ts
 */
import assert from "node:assert/strict";
import { applyTextToSlide, type SlidePayload } from "../src/lib/broadcast";

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : e}`); }
}

console.log("Plain-lyric slide (no objects):");
test("updates the flattened text, stays objectless", () => {
  const before: SlidePayload = { kind: "text", text: "old words" };
  const after = applyTextToSlide(before, "new words");
  assert.equal(after.kind, "text");
  if (after.kind !== "text") return;
  assert.equal(after.text, "new words");
  assert.equal(after.objects, undefined);
  assert.notStrictEqual(after, before, "returns a copy, not the same object");
});

console.log("Designed slide (styled text object): layout preserved, words swapped:");
const designed: SlidePayload = {
  kind: "text", text: "old lyric",
  bgColor: "#101014",
  objects: [
    { kind: "text", x: 80, y: 400, w: 1760, h: 280, text: "old lyric", fontFamily: "Playfair Display", fontSize: 96, fontWeight: 700, color: "#ffd700", align: "center", uppercase: false },
    { kind: "shape", x: 0, y: 0, w: 1920, h: 1080, shape: "rect", fill: "#000000" },
  ],
};
test("first text object text updated; geometry/style kept", () => {
  const after = applyTextToSlide(designed, "new lyric");
  if (after.kind !== "text" || !after.objects) throw new Error("expected objects");
  const t = after.objects[0] as Record<string, unknown>;
  assert.equal(t.text, "new lyric", "text swapped");
  assert.equal(t.fontFamily, "Playfair Display", "font preserved");
  assert.equal(t.fontSize, 96, "size preserved");
  assert.equal(t.fontWeight, 700, "weight preserved");
  assert.equal(t.color, "#ffd700", "colour preserved");
  assert.equal(t.x, 80); assert.equal(t.w, 1760); // geometry preserved
});
test("non-text objects (shape/bg) untouched", () => {
  const after = applyTextToSlide(designed, "new lyric");
  if (after.kind !== "text" || !after.objects) throw new Error("expected objects");
  assert.deepEqual(after.objects[1], designed.kind === "text" ? designed.objects![1] : null, "shape unchanged");
  assert.equal(after.bgColor, "#101014", "bg preserved");
});
test("flattened text fallback also updated", () => {
  const after = applyTextToSlide(designed, "new lyric");
  assert.equal(after.kind === "text" ? after.text : "", "new lyric");
});
test("original slide is NOT mutated", () => {
  const snapshot = JSON.stringify(designed);
  applyTextToSlide(designed, "totally different");
  assert.equal(JSON.stringify(designed), snapshot, "input must be immutable");
});

console.log("Multiple text objects: only the FIRST is swapped (single-textarea intent):");
test("second text object left alone", () => {
  const multi: SlidePayload = { kind: "text", text: "a", objects: [
    { kind: "text", x: 0, y: 0, w: 100, h: 50, text: "first" },
    { kind: "text", x: 0, y: 60, w: 100, h: 50, text: "second" },
  ] };
  const after = applyTextToSlide(multi, "EDITED");
  if (after.kind !== "text" || !after.objects) throw new Error("expected objects");
  assert.equal((after.objects[0] as { text: string }).text, "EDITED");
  assert.equal((after.objects[1] as { text: string }).text, "second");
});

console.log("Non-text slide is returned unchanged:");
test("image slide passes through (===)", () => {
  const img: SlidePayload = { kind: "image", url: "https://x/y.jpg" };
  assert.strictEqual(applyTextToSlide(img, "x"), img);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
