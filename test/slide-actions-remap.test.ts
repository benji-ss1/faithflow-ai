import { test } from "node:test";
import assert from "node:assert/strict";
import { remapSlideActionsForReorder, removeSlideActionAt } from "../src/lib/slide-actions-remap";

const A = [{ type: "logo" }];
const B = [{ type: "clear_lower_third" }];

test("reorder: keys follow their slides (perm[newIdx] = oldIdx)", () => {
  // slides [s0,s1,s2] -> [s2,s0,s1]
  assert.deepEqual(remapSlideActionsForReorder({ "0": A, "2": B }, [2, 0, 1]), { "1": A, "0": B });
});

test("reorder: identity perm is a no-op; extra (appended) slide keys + non-index keys untouched", () => {
  assert.deepEqual(remapSlideActionsForReorder({ "1": A }, [0, 1]), { "1": A });
  // base N=2; key "2" is an appended extra image slide -> stays
  assert.deepEqual(remapSlideActionsForReorder({ "0": A, "2": B, weird: 1 }, [1, 0]), { "1": A, "2": B, weird: 1 });
});

test("reorder: invalid map or non-permutation -> null (caller leaves the map alone)", () => {
  assert.equal(remapSlideActionsForReorder(undefined, [0]), null);
  assert.equal(remapSlideActionsForReorder([A], [0]), null);
  assert.equal(remapSlideActionsForReorder({ "0": A }, [0, 0]), null);
  assert.equal(remapSlideActionsForReorder({ "0": A }, [0, 5]), null);
  assert.equal(remapSlideActionsForReorder({ "0": A }, [0, -1]), null);
});

test("reorder: '01' is not an index key (kept verbatim)", () => {
  assert.deepEqual(remapSlideActionsForReorder({ "01": A }, [1, 0]), { "01": A });
});

test("delete: drops the removed slide's key and shifts higher keys down", () => {
  assert.deepEqual(removeSlideActionAt({ "0": A, "1": B, "3": A, x: 1 }, 1), { "0": A, "2": A, x: 1 });
  assert.equal(removeSlideActionAt(null, 0), null);
  assert.equal(removeSlideActionAt({}, -1), null);
});
