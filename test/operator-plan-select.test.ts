/**
 * Operator plan-swap field bug (2026-09-14, JPD) — pure helper tests.
 * Run: npx tsx --test test/operator-plan-select.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pickTodaysPlan,
  decidePlanPropChange,
  adHocCleanupTargets,
  nextItemOrder,
  isUuid,
  shouldPinPlanUrl,
  recentChurchDayKeys,
} from "../src/lib/operator-plan-select";

const A = "00000000-0000-4000-8000-000000000001"; // smallest UUID
const B = "b4349c65-0000-4000-8000-000000000002";
const Z = "ffffffff-0000-4000-8000-000000000003"; // largest UUID

test("pickTodaysPlan picks newest by createdAt regardless of UUID order", () => {
  const rows = [
    { id: Z, createdAt: new Date("2026-09-15T00:00:00Z") },
    { id: A, createdAt: new Date("2026-09-15T02:00:00Z") },
    { id: B, createdAt: "2026-09-15T01:00:00Z" },
  ];
  assert.equal(pickTodaysPlan(rows)?.id, A);
  assert.equal(pickTodaysPlan([...rows].reverse())?.id, A);
  assert.equal(pickTodaysPlan([]), null);
});

test("pickTodaysPlan tiebreaks equal createdAt deterministically by id desc", () => {
  const t = new Date("2026-09-14T23:11:33Z");
  assert.equal(pickTodaysPlan([{ id: A, createdAt: t }, { id: Z, createdAt: t }])?.id, Z);
});

test("console keeps the current plan when a refresh returns a different id on /operator", () => {
  assert.equal(decidePlanPropChange(A, B, true), "hold");
  assert.equal(decidePlanPropChange(A, A, true), "adopt");
  assert.equal(decidePlanPropChange(null, B, true), "adopt");
  // explicit deep link names the plan in the URL → adopt
  assert.equal(decidePlanPropChange(A, B, false), "adopt");
});

test("ad-hoc clean-up keeps the newest and never deletes plans with items", () => {
  const rows = [
    { id: Z, createdAt: new Date("2026-09-14T01:02:00Z"), itemCount: 9 }, // old, has items, largest UUID
    { id: A, createdAt: new Date("2026-09-14T23:11:33.010Z"), itemCount: 0 }, // newest
    { id: B, createdAt: new Date("2026-09-14T23:11:32.995Z"), itemCount: 0 }, // empty dup
  ];
  const del = adHocCleanupTargets(rows);
  assert.deepEqual(del, [B]);
  assert.ok(!del.includes(A), "newest kept");
  assert.ok(!del.includes(Z), "plan with items never deleted");
  assert.deepEqual(adHocCleanupTargets([rows[0]]), []);
  // even when the newest is empty and all older have items, nothing with items goes
  assert.deepEqual(adHocCleanupTargets([
    { id: A, createdAt: 2, itemCount: 0 },
    { id: B, createdAt: 1, itemCount: 3 },
  ]), []);
});

test("adding a header to a plan with N items leaves N+1 with order intact", () => {
  const items = Array.from({ length: 9 }, (_, i) => ({ id: `i${i}`, order: i, type: "song" }));
  const header = { id: "h", order: nextItemOrder(items), type: "header" };
  const after = [...items, header].sort((a, b) => a.order - b.order);
  assert.equal(after.length, 10);
  assert.deepEqual(after.slice(0, 9).map((x) => x.id), items.map((x) => x.id));
  assert.equal(after[9].id, "h");
  assert.equal(nextItemOrder([]), 0);
  assert.equal(nextItemOrder([{ order: 0 }, { order: 7 }]), 8); // survives gaps from deletes
});

test("pinnedPlanMissing: a deleted pinned plan is not held forever", () => {
  // server fell back from pinned A (deleted) to B on the landing → adopt B
  assert.equal(decidePlanPropChange(A, B, true, true), "adopt");
  // without the signal a different id is still held
  assert.equal(decidePlanPropChange(A, B, true, false), "hold");
});

test("shouldPinPlanUrl never pins offline or on a restored snapshot", () => {
  const base = { onLandingRoute: true, online: true, restoredFromSnapshot: false, planId: A, urlPlanId: null };
  assert.equal(shouldPinPlanUrl(base), true);
  assert.equal(shouldPinPlanUrl({ ...base, online: false }), false);
  assert.equal(shouldPinPlanUrl({ ...base, restoredFromSnapshot: true }), false);
  assert.equal(shouldPinPlanUrl({ ...base, urlPlanId: A }), false);
  assert.equal(shouldPinPlanUrl({ ...base, urlPlanId: B }), true); // missing-pin fallback repins
  assert.equal(shouldPinPlanUrl({ ...base, onLandingRoute: false }), false);
  assert.equal(shouldPinPlanUrl({ ...base, planId: undefined }), false);
});

test("clean-up skips ad-hoc plans scheduled today/yesterday in the church tz", () => {
  const now = new Date("2026-09-14T23:30:00Z"); // 00:30 Irish time on 15 Sep
  const days = recentChurchDayKeys("Europe/Dublin", now);
  assert.deepEqual(days, ["2026-09-15", "2026-09-14"]);
  const rows = [
    { id: A, createdAt: 5, itemCount: 0, scheduledFor: "2026-09-15" }, // newest (kept anyway)
    { id: B, createdAt: 4, itemCount: 0, scheduledFor: "2026-09-15" }, // today dup → protected
    { id: Z, createdAt: 3, itemCount: 0, scheduledFor: "2026-09-14" }, // yesterday → protected
    { id: "old-empty", createdAt: 2, itemCount: 0, scheduledFor: "2026-09-01" }, // deletable
    { id: "old-items", createdAt: 1, itemCount: 4, scheduledFor: "2026-09-01" }, // has items
  ];
  assert.deepEqual(adHocCleanupTargets(rows, days), ["old-empty"]);
  assert.deepEqual(adHocCleanupTargets(rows), [B, Z, "old-empty"]);
});

test("isUuid rejects non-uuid ?plan values", () => {
  assert.ok(isUuid(A));
  assert.ok(!isUuid("__ephemeral__"));
  assert.ok(!isUuid("1' OR 1=1"));
});
