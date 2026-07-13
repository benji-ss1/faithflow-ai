/**
 * Pure validator for reorderItemSlides. Extracted so it can be unit-tested
 * without a live DB. Not a server action — lives outside "use server" scope.
 * Returns { ok: true } if `newOrder` is a valid permutation of `existingIds`;
 * else a specific error string.
 */
export function validateReorderItemSlides(
  newOrder: string[],
  existingIds: string[]
): { ok: true } | { ok: false; error: string } {
  if (newOrder.length !== existingIds.length) {
    return { ok: false, error: "newOrder length mismatch" };
  }
  const existingSet = new Set(existingIds);
  const seen = new Set<string>();
  for (const id of newOrder) {
    if (!existingSet.has(id)) return { ok: false, error: "Unknown slide id" };
    if (seen.has(id)) return { ok: false, error: "Duplicate slide id" };
    seen.add(id);
  }
  return { ok: true };
}
