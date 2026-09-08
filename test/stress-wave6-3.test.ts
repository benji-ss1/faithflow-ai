/**
 * Wave-6 SIX-AGENT GATE — agent 3/6 STRESS. Adversarial probes for the
 * Groups & Arrangements engine, the ghost-war epoch convergence, and the
 * group-preserve quick-edit path. Pure-model only (no DOM/DB).
 *
 * Run: npx tsx --test test/stress-wave6-3.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeArrangementBlocks } from "../src/lib/arrangement-strip";
import { preservedGroupIds } from "../src/lib/song-group-preserve";
import { rebuildOverridesFromSnapshot, type EpochRef } from "../src/lib/output-layers";
import type { LayerWire } from "../src/lib/broadcast";
import { expandArrangement as expand, type ArrangedSong, type SlideRef } from "../src/engine/arrangements";

// ─────────────────────────────────────────────────────────────────────────────
// (1) GHOST WARS — three operators, distinct epochs, interleaved snapshots.
// ─────────────────────────────────────────────────────────────────────────────
function bg(id: string, rev: number): LayerWire {
  return { id: "background", kind: "background", z: 0, enabled: true, payload: { type: "image", url: id } as unknown as LayerWire["payload"], rev } as LayerWire;
}
function payloadUrl(m: Map<string, LayerWire>): string | undefined {
  const b = m.get("background");
  return b && b.payload ? (b.payload as { url?: string }).url : undefined;
}

test("ghost wars: three tabs (E1<E2<E3) converge to the HIGHEST epoch regardless of arrival order", () => {
  const map = new Map<string, LayerWire>();
  const epochRef: EpochRef = { current: undefined };
  const E1 = 1000, E2 = 2000, E3 = 3000;
  // Interleave: E2 first, then E1 (ghost), then E3 (newest), then E1 again, then E2 again.
  rebuildOverridesFromSnapshot(map, [bg("E2", E2 + 1)], { snapEpoch: E2, epochRef });
  assert.equal(payloadUrl(map), "E2");
  rebuildOverridesFromSnapshot(map, [bg("E1", E1 + 1)], { snapEpoch: E1, epochRef }); // ghost — ignored
  assert.equal(payloadUrl(map), "E2", "older E1 ghost ignored");
  rebuildOverridesFromSnapshot(map, [bg("E3", E3 + 1)], { snapEpoch: E3, epochRef }); // newest wins
  assert.equal(payloadUrl(map), "E3");
  rebuildOverridesFromSnapshot(map, [bg("E1", E1 + 5)], { snapEpoch: E1, epochRef }); // ghost
  rebuildOverridesFromSnapshot(map, [bg("E2", E2 + 5)], { snapEpoch: E2, epochRef }); // ghost
  assert.equal(payloadUrl(map), "E3", "converged + PINNED to highest epoch — no 3-way flap");
  assert.equal(epochRef.current, E3);
});

test("ghost wars: epoch-equal TIE (two tabs opened same ms) falls to rev-gated merge — last higher-rev wins, can still clobber", () => {
  // Two DISTINCT operator tabs can share an epoch only if module-load Date.now()
  // collided (same-ms open). Then snapEpoch === stored → rev-gated merge, NOT
  // authoritative replace. This is the residual 🟡 duel, now bounded to same-ms tabs.
  const map = new Map<string, LayerWire>();
  const epochRef: EpochRef = { current: undefined };
  const E = 5000;
  rebuildOverridesFromSnapshot(map, [bg("tabA", E + 10)], { snapEpoch: E, epochRef });
  assert.equal(payloadUrl(map), "tabA");
  // tabB same epoch, higher rev → wins the merge.
  rebuildOverridesFromSnapshot(map, [bg("tabB", E + 20)], { snapEpoch: E, epochRef });
  assert.equal(payloadUrl(map), "tabB", "same-epoch higher-rev merges over");
  // tabA re-heartbeats with a LOWER rev than tabB's stored → rev-gate drops it (no regression).
  rebuildOverridesFromSnapshot(map, [bg("tabA", E + 15)], { snapEpoch: E, epochRef });
  assert.equal(payloadUrl(map), "tabB", "stale same-epoch heartbeat rev-gated out (converges, no flap)");
});

// ─────────────────────────────────────────────────────────────────────────────
// (2) ARRANGEMENT CHAOS
// ─────────────────────────────────────────────────────────────────────────────
function song(): ArrangedSong<{ n: string }> {
  const slides: SlideRef<{ n: string }>[] = [
    { id: "v1", groupId: "gV", n: "v1" },
    { id: "c1", groupId: "gC", n: "c1" },
    { id: "c2", groupId: "gC", n: "c2" },
  ];
  return {
    songId: "s",
    slides,
    groups: [
      { id: "gV", name: "V", kind: "verse", color: null, order: 0 },
      { id: "gC", name: "C", kind: "chorus", color: null, order: 1 },
    ],
    arrangements: [
      { id: "arr", name: "A", isDefault: false, sort: 0, order: ["gV", "gC", "gV", "gC"] },
    ],
  };
}

test("chaos: pin arrangement → DELETE a group still referenced in its order → expand skips it, no crash, slides survive in master", () => {
  const s = song();
  // Simulate deleting group gV: remove it from groups (slides still tagged gV — orphaned).
  s.groups = s.groups.filter((g) => g.id !== "gV");
  const out = expand(s, "arr");
  // gV skipped everywhere it appears in the order; only gC slides remain (twice).
  assert.deepEqual(out.map((x) => x.id), ["c1", "c2", "c1", "c2"]);
  // Master (undefined pin) still shows the orphaned slide — not lost.
  assert.deepEqual(expand(s, undefined).map((x) => x.id), ["v1", "c1", "c2"]);
});

test("chaos: 200-repeat arrangement expands + strips without error (perf/consistency)", () => {
  const s = song();
  const order = Array.from({ length: 200 }, () => "gC"); // chorus x200
  s.arrangements.push({ id: "big", name: "Big", isDefault: false, sort: 1, order });
  const out = expand(s, "big");
  assert.equal(out.length, 400, "200 reps × 2 chorus slides");
  const groupIds = out.map((x) => x.groupId!);
  const blocks = computeArrangementBlocks(groupIds, order);
  assert.equal(blocks.length, 200, "one chip per order entry");
  assert.equal(blocks[199].startSlide, 398);
  assert.equal(blocks[199].slideCount, 2);
});

test("chaos: pin then DELETE the whole arrangement → unknown id falls back to master (no dead-end)", () => {
  const s = song();
  s.arrangements = []; // arrangement removed
  assert.deepEqual(expand(s, "arr").map((x) => x.id), ["v1", "c1", "c2"], "unknown pin → master");
});

test("chaos: empty order array → strip yields no blocks; expand yields empty (grouped-only)", () => {
  const s = song();
  s.arrangements.push({ id: "empty", name: "E", isDefault: false, sort: 2, order: [] });
  // order.length === 0 → expandArrangement returns [] (no groups emitted).
  assert.deepEqual(expand(s, "empty").map((x) => x.id), []);
  // Strip: order [] is treated as MASTER mode (order && length>0 is false) → coalesce.
  assert.deepEqual(computeArrangementBlocks([], []), []);
});

test("chaos: inconsistent expanded/order (defensive) — non-divisible counts drift but never crash", () => {
  // order says gC twice, but expanded has 3 gC slides (shouldn't happen from expand,
  // but the strip must be total on any input). size = floor(3/2) = 1 → 2 blocks cover 2,
  // the 3rd slide is simply not chipped. No throw, cursor stays in range.
  const blocks = computeArrangementBlocks(["c", "c", "c"], ["c", "c"]);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].slideCount, 1);
  assert.equal(blocks[1].startSlide, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// (3) GROUP-PRESERVE REORDER — FIXED in the wave-6 fix pass: content (exact
// prior-lyric text) match now lands the labels on the right slides after a swap.
// ─────────────────────────────────────────────────────────────────────────────
test("group-preserve FIX: same count but slides REORDERED → labels follow the TEXT", () => {
  // Prior: verse line "V"→gV, chorus line "C"→gC. Operator swaps the two lines
  // (same count). The helper now sees prior+new lyrics and matches by exact text,
  // so the chorus line keeps gC and the verse line keeps gV after the swap.
  const carried = preservedGroupIds(
    [{ lyrics: "V", groupId: "gV" }, { lyrics: "C", groupId: "gC" }],
    ["C", "V"],
  );
  assert.deepEqual(carried, ["gC", "gV"], "text-match re-assigns to the moved lines correctly");
});

test("group-preserve: any count change stays SAFE (all ungrouped) — the conservative branch is intact", () => {
  assert.deepEqual(preservedGroupIds([{ lyrics: "V", groupId: "gV" }, { lyrics: "C", groupId: "gC" }], ["a", "b", "c"]), [null, null, null]);
  assert.deepEqual(preservedGroupIds([{ lyrics: "V", groupId: "gV" }, { lyrics: "C", groupId: "gC" }, { lyrics: "B", groupId: "gB" }], ["a", "b"]), [null, null]);
});
