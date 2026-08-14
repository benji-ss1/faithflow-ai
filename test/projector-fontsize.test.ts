/**
 * Unit tests for the "aggressive largest-fit" projector sizing helpers and the
 * Bible reference-hierarchy splitter. Pure / DOM-free — the binary-search fit
 * itself needs a browser, but the ceiling/floor math and the ref split are
 * deterministic and covered here.
 *
 * Run via:  npx tsx test/projector-fontsize.test.ts
 */
import assert from "node:assert";
import {
  projectorCeilingPx,
  projectorFloorPx,
  calculateProjectorFontSize,
  PROJECTOR_MAX_BODY_FRACTION,
  PROJECTOR_MIN_BODY_FRACTION,
} from "../src/lib/projectorFontSize";
import { splitTrailingRef } from "../src/components/live/AutoFitText";

let pass = 0;
let fail = 0;
function run(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name} — ${(e as Error).message}`); fail++; }
}

// ---- ceiling / floor -------------------------------------------------------

run("ceiling is 24% of height on 1080p", () => {
  assert.strictEqual(projectorCeilingPx(1080), Math.round(0.30 * 1080)); // 324
});
run("ceiling scales to 4K", () => {
  assert.strictEqual(projectorCeilingPx(2160), Math.round(0.30 * 2160)); // 648
});
run("ceiling has a sane absolute minimum on tiny surfaces", () => {
  assert.strictEqual(projectorCeilingPx(100), 48); // 0.30*100=30 → clamped to 48
});
run("ceiling always exceeds floor (search range never inverted)", () => {
  for (const h of [120, 200, 340, 720, 1080, 1440, 2160, 4320]) {
    assert.ok(projectorCeilingPx(h) > projectorFloorPx(h), `h=${h}`);
  }
});
run("ceiling raised above the old 0.12 cap", () => {
  assert.ok(PROJECTOR_MAX_BODY_FRACTION >= 0.30);
  assert.ok(PROJECTOR_MAX_BODY_FRACTION > PROJECTOR_MIN_BODY_FRACTION);
});
run("floor is the sanctuary-readable 9%/16px (raised 2026-08-14)", () => {
  assert.strictEqual(projectorFloorPx(1080), Math.round(0.09 * 1080)); // 97
  assert.strictEqual(projectorFloorPx(200), 18); // 0.09*200=18
});
run("band seed still returns a size within [floor, ceil]", () => {
  const h = 1080;
  const s = calculateProjectorFontSize("Jesus saves", h);
  assert.ok(s >= projectorFloorPx(h) && s <= projectorCeilingPx(h) + 1);
});

// ---- reference hierarchy split ---------------------------------------------

run("splits a trailing scripture reference from the verse", () => {
  const r = splitTrailingRef("For God so loved the world\n\nJohn 3:16 (KJV)");
  assert.strictEqual(r.body, "For God so loved the world");
  assert.strictEqual(r.ref, "John 3:16 (KJV)");
});
run("handles a verse range and numbered book", () => {
  const r = splitTrailingRef("Love is patient, love is kind\n\n1 Corinthians 13:4-7");
  assert.strictEqual(r.ref, "1 Corinthians 13:4-7");
  assert.ok(r.body.startsWith("Love is patient"));
});
run("song lyrics with no reference render whole (ref empty)", () => {
  const r = splitTrailingRef("Amazing grace how sweet the sound\nThat saved a wretch like me");
  assert.strictEqual(r.ref, "");
  assert.ok(r.body.includes("Amazing grace"));
});
run("reference-only slide renders whole at primary size (degenerate guard)", () => {
  const r = splitTrailingRef("\n\nJohn 3:16");
  assert.strictEqual(r.ref, ""); // not split — body would be empty
  assert.ok(r.body.includes("John 3:16"));
});
run("empty text is safe", () => {
  const r = splitTrailingRef("");
  assert.deepStrictEqual(r, { body: "", ref: "" });
});
run("no interior mis-split on a normal sentence", () => {
  const r = splitTrailingRef("He said go to the store at 3:16 today");
  assert.strictEqual(r.ref, ""); // no leading \n\n before a Book ch:verse
});

console.log(`\n=== projector-fontsize: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
