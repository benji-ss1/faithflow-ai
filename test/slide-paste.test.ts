/**
 * Slide copy/paste pure helpers (field fix 5B-2).
 * Run: npx tsx test/slide-paste.test.ts
 */
import assert from "node:assert/strict";
import { pasteInsertIndex, pasteDisabledReason, canPasteSlide } from "../src/lib/slide-paste";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}

// ── pasteInsertIndex ─────────────────────────────────────────────────────────
check("paste after slide 0 → index 1", () => assert.equal(pasteInsertIndex(1, 3), 1));
check("paste at end (== length) stays at end", () => assert.equal(pasteInsertIndex(3, 3), 3));
check("beyond end clamps to length", () => assert.equal(pasteInsertIndex(99, 3), 3));
check("negative clamps to 0", () => assert.equal(pasteInsertIndex(-5, 3), 0));
check("NaN fail-softs to end", () => assert.equal(pasteInsertIndex(Number.NaN, 3), 3));
check("empty list → 0", () => assert.equal(pasteInsertIndex(1, 0), 0));

// ── pasteDisabledReason / canPasteSlide ──────────────────────────────────────
check("no clipboard → reason about copying first", () => {
  const r = pasteDisabledReason(false, true);
  assert.ok(r && /copy a slide first/i.test(r));
  assert.equal(canPasteSlide(false, true), false);
});
check("clipboard but non-song → honest 'only inside a song' reason", () => {
  const r = pasteDisabledReason(true, false);
  assert.ok(r && /only inside a song/i.test(r));
  assert.equal(canPasteSlide(true, false), false);
});
check("clipboard + editable song → allowed (null reason)", () => {
  assert.equal(pasteDisabledReason(true, true), null);
  assert.equal(canPasteSlide(true, true), true);
});
check("no clipboard AND non-song → clipboard reason wins (copy first)", () => {
  const r = pasteDisabledReason(false, false);
  assert.ok(r && /copy a slide first/i.test(r));
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
