/**
 * operator-nav (Y5) — the operator preview navigation must SKIP header items
 * (slides:[]) in both directions and never produce a bad slideIdx (-1 / OOB).
 *
 * Run: npx tsx test/operator-nav.test.ts
 */
import assert from "node:assert/strict";
import { nextPreviewPosition, type NavItem, type NavPosition } from "../src/lib/operator-nav";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}

const s = (n: number): NavItem => ({ slides: Array.from({ length: n }) });
const header: NavItem = { slides: [] };

check("forward skips a header between two content items", () => {
  const items = [s(2), header, s(2)]; // song(2) | header | song(2)
  // On last slide of item 0 → move forward → skip header → item 2 slide 0.
  const out = nextPreviewPosition(items, { itemIdx: 0, slideIdx: 1 }, 1);
  assert.deepEqual(out, { itemIdx: 2, slideIdx: 0 });
});

check("backward skips a header (never yields slideIdx -1)", () => {
  const items = [s(2), header, s(2)];
  // On first slide of item 2 → move back → skip header → item 0 last slide.
  const out = nextPreviewPosition(items, { itemIdx: 2, slideIdx: 0 }, -1);
  assert.deepEqual(out, { itemIdx: 0, slideIdx: 1 });
  assert.ok(out.slideIdx >= 0, "slideIdx must never be negative");
});

check("skips consecutive headers", () => {
  const items = [s(1), header, header, s(1)];
  assert.deepEqual(nextPreviewPosition(items, { itemIdx: 0, slideIdx: 0 }, 1), { itemIdx: 3, slideIdx: 0 });
  assert.deepEqual(nextPreviewPosition(items, { itemIdx: 3, slideIdx: 0 }, -1), { itemIdx: 0, slideIdx: 0 });
});

check("no-op at the ends (returns the same object)", () => {
  const items = [s(2), header];
  const cur: NavPosition = { itemIdx: 0, slideIdx: 1 };
  // Forward past the last content slide (only a trailing header remains) → no-op.
  assert.equal(nextPreviewPosition(items, cur, 1), cur);
  const first: NavPosition = { itemIdx: 0, slideIdx: 0 };
  assert.equal(nextPreviewPosition(items, first, -1), first);
});

check("starting ON a header still navigates to real slides", () => {
  const items = [s(1), header, s(1)];
  assert.deepEqual(nextPreviewPosition(items, { itemIdx: 1, slideIdx: 0 }, 1), { itemIdx: 2, slideIdx: 0 });
  assert.deepEqual(nextPreviewPosition(items, { itemIdx: 1, slideIdx: 0 }, -1), { itemIdx: 0, slideIdx: 0 });
});

check("all-header plan is a safe no-op (never loops forever / crashes)", () => {
  const items = [header, header, header];
  const cur: NavPosition = { itemIdx: 1, slideIdx: 0 };
  assert.equal(nextPreviewPosition(items, cur, 1), cur);
  assert.equal(nextPreviewPosition(items, cur, -1), cur);
});

console.log(`\noperator-nav: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
