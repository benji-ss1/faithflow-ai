// Run: npx tsx --test test/arrangement-strip.test.ts
// Uses node:test (the repo's runner — vitest is not installed). A tiny shim maps
// the describe/it/expect shape the assertions are written in onto node:assert.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeArrangementBlocks, blockAtSlide } from "../src/lib/arrangement-strip";

function describe(name: string, fn: () => void) { fn(); void name; }
const it = (name: string, fn: () => void) => test(name, fn);
function expect(actual: unknown) {
  return {
    toEqual: (expected: unknown) => assert.deepEqual(actual, expected),
    toBe: (expected: unknown) => assert.equal(actual, expected),
    toBeNull: () => assert.equal(actual, null),
  };
}

describe("computeArrangementBlocks — pinned (order given)", () => {
  it("one block per order entry, repeats become separate chips", () => {
    // groups: V(2 slides), C(1 slide). order: V, C, V, C
    // expanded slideGroupIds: V,V,C,V,V,C
    const ids = ["v", "v", "c", "v", "v", "c"];
    const blocks = computeArrangementBlocks(ids, ["v", "c", "v", "c"]);
    expect(blocks).toEqual([
      { groupId: "v", startSlide: 0, slideCount: 2, orderIndex: 0 },
      { groupId: "c", startSlide: 2, slideCount: 1, orderIndex: 1 },
      { groupId: "v", startSlide: 3, slideCount: 2, orderIndex: 2 },
      { groupId: "c", startSlide: 5, slideCount: 1, orderIndex: 3 },
    ]);
  });

  it("consecutive repeat of the same group yields two blocks", () => {
    // C has 1 slide, order C,C → expanded c,c
    const blocks = computeArrangementBlocks(["c", "c"], ["c", "c"]);
    expect(blocks.map((b) => b.startSlide)).toEqual([0, 1]);
    expect(blocks.map((b) => b.orderIndex)).toEqual([0, 1]);
  });

  it("skips an order entry whose group has no slides", () => {
    const blocks = computeArrangementBlocks(["v"], ["v", "ghost"]);
    expect(blocks).toEqual([{ groupId: "v", startSlide: 0, slideCount: 1, orderIndex: 0 }]);
  });
});

describe("computeArrangementBlocks — master (order null)", () => {
  it("coalesces consecutive equal ids, skips nulls but keeps indices", () => {
    const ids = ["v", "v", null, "c", "c", "c"];
    const blocks = computeArrangementBlocks(ids, null);
    expect(blocks).toEqual([
      { groupId: "v", startSlide: 0, slideCount: 2, orderIndex: null },
      { groupId: "c", startSlide: 3, slideCount: 3, orderIndex: null },
    ]);
  });

  it("empty / all-null yields no blocks", () => {
    expect(computeArrangementBlocks([], null)).toEqual([]);
    expect(computeArrangementBlocks([null, null], null)).toEqual([]);
  });
});

describe("blockAtSlide", () => {
  const blocks = computeArrangementBlocks(["v", "v", "c", "v", "v", "c"], ["v", "c", "v", "c"]);
  it("maps a slide index to its containing block", () => {
    expect(blockAtSlide(blocks, 0)).toBe(0);
    expect(blockAtSlide(blocks, 1)).toBe(0);
    expect(blockAtSlide(blocks, 2)).toBe(1);
    expect(blockAtSlide(blocks, 3)).toBe(2);
    expect(blockAtSlide(blocks, 5)).toBe(3);
  });
  it("returns null when out of range", () => {
    expect(blockAtSlide(blocks, 99)).toBeNull();
  });
});
