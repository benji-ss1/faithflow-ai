// Pure helpers for how the /operator landing picks and holds a service plan.
// Field bug 2026-09-14 (JPD): a router.refresh() after midnight resolved a NEW
// empty "today" plan and the console silently swapped to it ("playlist wiped").
// Kept dependency-free so they are directly unit-testable (test/operator-plan-select.test.ts).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

type Dated = { id: string; createdAt: Date | string | number };

function ts(v: Date | string | number): number {
  const n = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(n) ? n : 0;
}

/** Newest first by createdAt, then id DESC as a deterministic tiebreak. */
export function sortNewestFirst<T extends Dated>(rows: T[]): T[] {
  return [...rows].sort((a, b) => ts(b.createdAt) - ts(a.createdAt) || b.id.localeCompare(a.id));
}

/** Pick today's plan: the most recently created one, never "smallest UUID". */
export function pickTodaysPlan<T extends Dated>(rows: T[]): T | null {
  return sortNewestFirst(rows)[0] ?? null;
}

/**
 * Decide what the console does when the server-rendered plan prop changes.
 * - same id → adopt (normal refresh after an edit)
 * - different id on the /operator landing → hold the plan on screen and offer
 *   a switch; a refresh must never silently swap the operator's playlist.
 * - different id on an explicit deep link (/services/<id>/operate) → adopt,
 *   because the URL itself names the plan.
 */
export function decidePlanPropChange(
  currentPlanId: string | null | undefined,
  incomingPlanId: string,
  onLandingRoute: boolean,
): "adopt" | "hold" {
  if (!currentPlanId || currentPlanId === incomingPlanId) return "adopt";
  return onLandingRoute ? "hold" : "adopt";
}

/**
 * Ad-hoc clean-up targets: keep the most recently created ad-hoc plan, and
 * NEVER delete a plan that has any items (service_items cascade on delete).
 */
export function adHocCleanupTargets<T extends Dated & { itemCount: number }>(rows: T[]): string[] {
  if (rows.length <= 1) return [];
  const [, ...older] = sortNewestFirst(rows);
  return older.filter((r) => Number(r.itemCount) === 0).map((r) => r.id);
}

/** Next append order for a plan item (mirrors addServiceItem). */
export function nextItemOrder(existing: { order: number }[]): number {
  return existing.length > 0 ? Math.max(...existing.map((e) => e.order)) + 1 : 0;
}
