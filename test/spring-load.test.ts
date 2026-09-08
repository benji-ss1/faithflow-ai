/**
 * Spring-loaded drag-and-drop pure core (Wave 3, item 4).
 * Run: npx tsx test/spring-load.test.ts
 */
import assert from "node:assert/strict";
import {
  SPRING_ARM_MS, SPRING_IDLE, classifyDrop, springEnter, springLeave, springTick, isArmed,
  insertIndexAfterHeader, orderAfterHeaderDrop, insertIdAtIndex, isRealDragLeave,
  PF_LIBRARY_ITEM_MIME, PF_LIBRARY_ITEMS_MIME,
} from "../src/lib/spring-load";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}

// ── classifyDrop ─────────────────────────────────────────────────────────────
check("library single-item drag classified", () => {
  assert.equal(classifyDrop([PF_LIBRARY_ITEM_MIME]), "library-item");
});
check("library multi-item group drag classified", () => {
  assert.equal(classifyDrop([PF_LIBRARY_ITEMS_MIME, "Files"]), "library-item");
});
check("OS file drag classified", () => {
  assert.equal(classifyDrop(["Files"]), "os-files");
});
check("unknown / empty drag is none", () => {
  assert.equal(classifyDrop(["text/plain"]), "none");
  assert.equal(classifyDrop([]), "none");
  assert.equal(classifyDrop(null), "none");
});

// ── spring-arm state machine ─────────────────────────────────────────────────
check("enter starts an unarmed hover", () => {
  const s = springEnter(SPRING_IDLE, "lib-1", 1000);
  assert.equal(s.hoverId, "lib-1");
  assert.equal(s.armed, false);
});
check("arms only after the dwell", () => {
  let s = springEnter(SPRING_IDLE, "lib-1", 1000);
  s = springTick(s, 1000 + SPRING_ARM_MS - 1);
  assert.equal(isArmed(s, "lib-1"), false);
  s = springTick(s, 1000 + SPRING_ARM_MS);
  assert.equal(isArmed(s, "lib-1"), true);
});
check("moving to a different target restarts the dwell", () => {
  let s = springEnter(SPRING_IDLE, "lib-1", 1000);
  s = springTick(s, 1000 + SPRING_ARM_MS); // armed on lib-1
  assert.equal(isArmed(s, "lib-1"), true);
  s = springEnter(s, "lib-2", 2000);
  assert.equal(s.armed, false);
  assert.equal(isArmed(s, "lib-2"), false);
});
check("re-entering the same armed target keeps it armed", () => {
  let s = springEnter(SPRING_IDLE, "lib-1", 1000);
  s = springTick(s, 1000 + SPRING_ARM_MS);
  const same = springEnter(s, "lib-1", 5000);
  assert.equal(same, s); // identity preserved
  assert.equal(isArmed(same, "lib-1"), true);
});
check("leave disarms", () => {
  let s = springEnter(SPRING_IDLE, "lib-1", 1000);
  s = springTick(s, 1000 + SPRING_ARM_MS);
  s = springLeave(s, "lib-1");
  assert.equal(s.hoverId, null);
  assert.equal(isArmed(s, "lib-1"), false);
});
check("a stale leave for an old target is ignored", () => {
  let s = springEnter(SPRING_IDLE, "lib-2", 2000);
  const after = springLeave(s, "lib-1"); // we already moved on to lib-2
  assert.equal(after, s);
});

// ── STRESS 3/6: boundary flapping / A→B→A / drop-at-arm-instant ──────────────
check("does NOT arm one tick before the boundary (599ms)", () => {
  let s = springEnter(SPRING_IDLE, "A", 0);
  s = springTick(s, SPRING_ARM_MS - 1);
  assert.equal(isArmed(s, "A"), false);
});
check("A→B→A flap keeps restarting the dwell (never arms mid-flap)", () => {
  let s = springEnter(SPRING_IDLE, "A", 0);
  s = springEnter(s, "B", 300); // switched before arming
  s = springTick(s, 500);       // 200ms into B — not enough
  assert.equal(s.armed, false);
  s = springEnter(s, "A", 500);  // flapped back to A, dwell restarts at 500
  s = springTick(s, 500 + SPRING_ARM_MS - 1);
  assert.equal(isArmed(s, "A"), false, "A must not inherit B's or its own earlier dwell");
  s = springTick(s, 500 + SPRING_ARM_MS);
  assert.equal(isArmed(s, "A"), true, "arms only after a full fresh dwell on A");
});
check("drop at the exact arm instant is armed (>= boundary)", () => {
  let s = springEnter(SPRING_IDLE, "A", 1000);
  s = springTick(s, 1000 + SPRING_ARM_MS); // exactly the boundary
  assert.equal(isArmed(s, "A"), true);
});
check("tick on an idle machine is a no-op (no spurious arm)", () => {
  const s = springTick(SPRING_IDLE, 999999);
  assert.equal(s, SPRING_IDLE, "identity preserved — unchanged");
  assert.equal(s.armed, false);
  assert.equal(s.hoverId, null);
});

// ── playlist header drop position ────────────────────────────────────────────
check("insert index is right after the header", () => {
  assert.equal(insertIndexAfterHeader(["h1", "a", "b"], "h1"), 1);
  assert.equal(insertIndexAfterHeader(["a", "h1", "b"], "h1"), 2);
});
check("insert index -1 when header missing", () => {
  assert.equal(insertIndexAfterHeader(["a", "b"], "h1"), -1);
});
check("orderAfterHeaderDrop relocates an existing item to first-in-section", () => {
  assert.deepEqual(orderAfterHeaderDrop(["h1", "a", "b", "c"], "h1", "c"), ["h1", "c", "a", "b"]);
});
check("orderAfterHeaderDrop inserts a fresh id after the header", () => {
  assert.deepEqual(orderAfterHeaderDrop(["a", "h1", "b"], "h1", "new"), ["a", "h1", "new", "b"]);
});
check("orderAfterHeaderDrop no-ops when header gone", () => {
  assert.deepEqual(orderAfterHeaderDrop(["a", "b"], "h1", "a"), ["a", "b"]);
});

// ── insertIdAtIndex (shared ordering primitive) ──────────────────────────────
check("insertIdAtIndex inserts a fresh id at the index", () => {
  assert.deepEqual(insertIdAtIndex(["a", "b", "c"], "new", 1), ["a", "new", "b", "c"]);
  assert.deepEqual(insertIdAtIndex(["a", "b", "c"], "new", 0), ["new", "a", "b", "c"]);
});
check("insertIdAtIndex appends when index at/after end", () => {
  assert.deepEqual(insertIdAtIndex(["a", "b"], "new", 2), ["a", "b", "new"]);
  assert.deepEqual(insertIdAtIndex(["a", "b"], "new", 99), ["a", "b", "new"]);
});
check("insertIdAtIndex clamps a negative index to the front", () => {
  assert.deepEqual(insertIdAtIndex(["a", "b"], "new", -5), ["new", "a", "b"]);
});
check("insertIdAtIndex fail-softs a non-finite index to append", () => {
  assert.deepEqual(insertIdAtIndex(["a", "b"], "new", NaN), ["a", "b", "new"]);
});
check("insertIdAtIndex relocates an id already present (no duplicate)", () => {
  assert.deepEqual(insertIdAtIndex(["a", "b", "c"], "c", 0), ["c", "a", "b"]);
  // clamp is computed against the post-removal length
  assert.deepEqual(insertIdAtIndex(["a", "b", "c"], "a", 99), ["b", "c", "a"]);
});
check("orderAfterHeaderDrop still routes through insertIdAtIndex (parity)", () => {
  assert.deepEqual(orderAfterHeaderDrop(["h1", "a", "b", "c"], "h1", "c"), ["h1", "c", "a", "b"]);
  assert.deepEqual(orderAfterHeaderDrop(["a", "h1", "b"], "h1", "new"), ["a", "h1", "new", "b"]);
});

// ── isRealDragLeave (dwell-restart guard) ────────────────────────────────────
const rowWithChild = { contains: (n: unknown) => n === "child" };
check("dragleave onto a CHILD of the row is not a real leave (dwell survives)", () => {
  assert.equal(isRealDragLeave(rowWithChild, "child"), false);
});
check("dragleave onto an outside node IS a real leave", () => {
  assert.equal(isRealDragLeave(rowWithChild, "outside"), true);
});
check("dragleave with no relatedTarget (left the window) IS a real leave", () => {
  assert.equal(isRealDragLeave(rowWithChild, null), true);
});
check("null currentTarget fail-softs to a real leave", () => {
  assert.equal(isRealDragLeave(null, "child"), true);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
