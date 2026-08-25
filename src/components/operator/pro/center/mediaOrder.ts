// Per-church custom ordering of the Media Library grid.
//
// The server returns media assets by createdAt (oldest first). Operators want to
// arrange them to taste, so we persist a custom order of asset ids in
// localStorage (church-scoped, versioned key — mirrors mediaFrame.ts). This is
// per-machine/per-browser; a DB `sort_order` column is the production upgrade
// path (same key shape → clean migration).
//
// Self-healing: applyOrder keeps unknown ids (new uploads not yet in the saved
// order) and drops ids no longer present — so a saved order can never HIDE a new
// asset or break on a deleted one.

const key = (churchId: string | undefined) => `pf.mediaOrder.v1.${churchId || "default"}`;

export function loadMediaOrder(churchId: string | undefined): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key(churchId));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function saveMediaOrder(churchId: string | undefined, ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key(churchId), JSON.stringify(ids));
  } catch {
    /* quota / disabled storage — non-fatal */
  }
}

/**
 * Reorder `items` (each with an `id`) by the saved order. Items present in the
 * saved order come first, in that order; any items NOT in the saved order (new
 * uploads) keep their incoming relative order and go to the END — so new media
 * is always visible and never silently sorted out of view.
 */
export function applyMediaOrder<T extends { id: string }>(items: T[], order: string[]): T[] {
  if (order.length === 0) return items;
  const rank = new Map(order.map((id, i) => [id, i]));
  const known: T[] = [];
  const fresh: T[] = [];
  for (const it of items) (rank.has(it.id) ? known : fresh).push(it);
  known.sort((a, b) => (rank.get(a.id)! - rank.get(b.id)!));
  return [...known, ...fresh];
}
