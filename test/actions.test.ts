// Task C: reorderItemSlides validator unit tests.
// Runs the pure-function slice (validateReorderItemSlides) without a DB.
// Auth + ownership guards are exercised via cross-church.test.ts elsewhere.
// Run: npx tsx test/actions.test.ts

import { validateReorderItemSlides } from "../src/lib/reorder-validator";

let passed = 0;
let failed = 0;
function assert(cond: unknown, label: string) {
  if (cond) { passed++; console.log(`  ok  ${label}`); }
  else { failed++; console.error(`  FAIL  ${label}`); }
}

console.log("validateReorderItemSlides");

// valid permutation
{
  const r = validateReorderItemSlides(["b", "a", "c"], ["a", "b", "c"]);
  assert(r.ok === true, "accepts a valid permutation");
}

// length mismatch
{
  const r = validateReorderItemSlides(["a", "b"], ["a", "b", "c"]);
  assert(r.ok === false && r.error === "newOrder length mismatch", "rejects length mismatch");
}

// unknown id
{
  const r = validateReorderItemSlides(["a", "b", "z"], ["a", "b", "c"]);
  assert(r.ok === false && r.error === "Unknown slide id", "rejects unknown slide id");
}

// duplicate id
{
  const r = validateReorderItemSlides(["a", "a", "b"], ["a", "b", "c"]);
  assert(r.ok === false && r.error === "Duplicate slide id", "rejects duplicate slide id");
}

// empty arrays are trivially valid
{
  const r = validateReorderItemSlides([], []);
  assert(r.ok === true, "accepts empty arrays");
}

// identity permutation
{
  const r = validateReorderItemSlides(["a", "b", "c"], ["a", "b", "c"]);
  assert(r.ok === true, "accepts identity permutation");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
