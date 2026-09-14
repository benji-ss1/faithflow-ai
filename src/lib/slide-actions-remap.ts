// Pure helpers keeping a NON-song item's sparse `payload.slideActions`
// (`{ [slideIdx]: ActionSpec[] }`) attached to the right slides when the item's
// slides are reordered or one is removed. No DB, no side effects — unit-tested
// in test/slide-actions-remap.test.ts.

type SparseMap = Record<string, unknown>;

function isPlainObject(v: unknown): v is SparseMap {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

const INDEX_KEY = /^(0|[1-9]\d*)$/;

/**
 * `perm[newIdx] = oldIdx` over the first `perm.length` (reorderable base)
 * slides. Keys for those slides move with their slide; keys at or beyond
 * `perm.length` (e.g. appended extra image slides) and non-index keys are kept
 * as-is. Returns `null` when `map` is not a plain object or `perm` is not a
 * permutation of 0..N-1 (caller must then leave the stored map untouched).
 */
export function remapSlideActionsForReorder(map: unknown, perm: readonly number[]): SparseMap | null {
  if (!isPlainObject(map)) return null;
  const n = perm.length;
  const newIdxOf = new Array<number>(n).fill(-1);
  for (let newIdx = 0; newIdx < n; newIdx++) {
    const oldIdx = perm[newIdx];
    if (!Number.isInteger(oldIdx) || oldIdx < 0 || oldIdx >= n || newIdxOf[oldIdx] !== -1) return null;
    newIdxOf[oldIdx] = newIdx;
  }
  const out: SparseMap = {};
  for (const k of Object.keys(map)) {
    if (INDEX_KEY.test(k) && Number(k) < n) out[String(newIdxOf[Number(k)])] = map[k];
    else out[k] = map[k];
  }
  return out;
}

/**
 * Drop the actions of the slide at `idx` and shift every higher index key down
 * by one (the slides after it move up). Non-index keys are kept. Returns `null`
 * when `map` is not a plain object or `idx` is not a non-negative integer.
 */
export function removeSlideActionAt(map: unknown, idx: number): SparseMap | null {
  if (!isPlainObject(map) || !Number.isInteger(idx) || idx < 0) return null;
  const out: SparseMap = {};
  for (const k of Object.keys(map)) {
    if (!INDEX_KEY.test(k)) { out[k] = map[k]; continue; }
    const i = Number(k);
    if (i < idx) out[k] = map[k];
    else if (i > idx) out[String(i - 1)] = map[k];
  }
  return out;
}
