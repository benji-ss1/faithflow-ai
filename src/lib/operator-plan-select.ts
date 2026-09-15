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
 * - the pinned ?plan no longer exists (server fell back) → adopt, so a deleted
 *   plan can't be held forever
 * - different id on the /operator landing → hold the plan on screen and offer
 *   a switch; a refresh must never silently swap the operator's playlist.
 * - different id on an explicit deep link (/services/<id>/operate) → adopt,
 *   because the URL itself names the plan.
 */
export function decidePlanPropChange(
  currentPlanId: string | null | undefined,
  incomingPlanId: string,
  onLandingRoute: boolean,
  pinnedPlanMissing = false,
): "adopt" | "hold" {
  if (!currentPlanId || currentPlanId === incomingPlanId) return "adopt";
  if (pinnedPlanMissing) return "adopt";
  return onLandingRoute ? "hold" : "adopt";
}

/**
 * Whether the console may pin `?plan=<id>` into the URL (a Next navigation).
 * Never while offline or while showing an offline-restored snapshot — the
 * navigation fetch would fail and a hard reload would lose the snapshot.
 */
export function shouldPinPlanUrl(opts: {
  onLandingRoute: boolean;
  online: boolean;
  restoredFromSnapshot: boolean;
  planId: string | null | undefined;
  urlPlanId: string | null | undefined;
}): boolean {
  if (!opts.onLandingRoute || !opts.planId) return false;
  if (!opts.online || opts.restoredFromSnapshot) return false;
  return opts.urlPlanId !== opts.planId;
}

/** YYYY-MM-DD for "today" and "yesterday" in the church timezone. */
export function recentChurchDayKeys(tz: string | null | undefined, now: Date = new Date()): string[] {
  const fmt = (d: Date) => {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    } catch {
      return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    }
  };
  const today = fmt(now);
  const yesterday = fmt(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  return Array.from(new Set([today, yesterday]));
}

/**
 * Ad-hoc clean-up targets: keep the most recently created ad-hoc plan, NEVER
 * delete a plan that has any items (service_items cascade on delete), and skip
 * plans scheduled for a protected day (today/yesterday — they may be open).
 * The DB delete re-checks items under a row lock; this is only the pre-filter.
 */
export function adHocCleanupTargets<T extends Dated & { itemCount: number; scheduledFor?: string | null }>(
  rows: T[],
  protectedDays: string[] = [],
): string[] {
  if (rows.length <= 1) return [];
  const protect = new Set(protectedDays);
  const [, ...older] = sortNewestFirst(rows);
  return older
    .filter((r) => Number(r.itemCount) === 0)
    .filter((r) => !(r.scheduledFor && protect.has(String(r.scheduledFor).slice(0, 10))))
    .map((r) => r.id);
}

/** Next append order for a plan item (mirrors addServiceItem). */
export function nextItemOrder(existing: { order: number }[]): number {
  return existing.length > 0 ? Math.max(...existing.map((e) => e.order)) + 1 : 0;
}
