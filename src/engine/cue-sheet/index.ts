/**
 * src/engine/cue-sheet — Phase 1 (P1) of the Engine Integration blueprint.
 *
 * A read-only projection over the EXISTING `ExpandedPlan` that gives the engine
 * a flat, structured view of the service ("cue sheet"). Pure TS: no React, no
 * side effects at module scope. Additive — replaces no existing navigation.
 *
 * BLUEPRINT CORRECTIONS (verified against the live repo, 2026-09-08):
 *   - `ExpandedItem` has `type: ServiceItemType` (NOT `kind`), `id: string`
 *     (required, never undefined), `title: string` (required), and NO per-slide
 *     `transition` field. The blueprint's `item.id ?? ...` / `item.kind` /
 *     `item.title ?? ""` fallbacks are therefore dead — adapted to the real
 *     shape. `itemKind` is renamed `itemType` to match reality.
 *   - HEADER items are non-content section dividers with `slides: []`. They
 *     contribute ZERO cue entries (the inner forEach never runs), so a cue sheet
 *     is already header-free by construction — matching the skip semantics of
 *     `nextPreviewPosition` in `@/lib/operator-nav`. Each entry also carries
 *     `isHeader` (always false today) for forward-compat + explicitness.
 *   - Navigation DELEGATES to the shared `nextPreviewPosition` helper rather
 *     than duplicating the empty-item / header skip walk, so there is exactly
 *     ONE skip predicate in the codebase (blueprint duplicated it via findIndex).
 */
import type { ExpandedPlan, ExpandedItem } from "@/lib/server/services";
import type { SlidePayload, TransitionSpec } from "@/lib/broadcast";
import { nextPreviewPosition, type NavPosition } from "@/lib/operator-nav";
import type { ItemId, SlideId } from "../types";

/** Actions attached to a cue (Phase 3 macros / Phase 8 slide-actions). */
export type CueAction = {
  type: "macro" | "clear_layer" | "start_timer" | "send_message" | "trigger_look";
  payload: Record<string, unknown>;
};

export type CueEntry = {
  itemIdx: number;
  slideIdx: number;
  itemId: ItemId;
  slideId: SlideId;
  slide: SlidePayload;
  itemTitle: string;
  /** Real plan item type: song | scripture | media | sermon | blank | logo. */
  itemType: string;
  /** Always false in a built sheet (headers carry no slides) — kept explicit
   *  so consumers never assume a cue can be a divider. */
  isHeader: boolean;
  /** No per-slide transition exists in ExpandedItem today; reserved (null). */
  transition?: TransitionSpec | null;
  /** Actions to fire when this cue goes live (Phase 3+). Empty for now. */
  actions: CueAction[];
};

/**
 * Build a flat cue list from an ExpandedPlan. Header items (slides:[]) and any
 * empty item contribute nothing, so the result is content-only and aligns with
 * the navigable positions produced by `nextPreviewPosition`.
 */
export function buildCueSheet(plan: ExpandedPlan): CueEntry[] {
  const entries: CueEntry[] = [];
  plan.items.forEach((item: ExpandedItem, itemIdx: number) => {
    const slides = item.slides ?? [];
    slides.forEach((slide: SlidePayload, slideIdx: number) => {
      entries.push({
        itemIdx,
        slideIdx,
        itemId: item.id as ItemId,
        slideId: `${item.id}-${slideIdx}` as SlideId,
        slide,
        itemTitle: item.title,
        itemType: item.type,
        isHeader: item.type === "header", // always false: headers have no slides
        transition: null,
        actions: [],
      });
    });
  });
  return entries;
}

/** Find the cue entry at an exact position, or null. */
export function cueAt(sheet: CueEntry[], pos: NavPosition): CueEntry | null {
  return (
    sheet.find((e) => e.itemIdx === pos.itemIdx && e.slideIdx === pos.slideIdx) ??
    null
  );
}

/**
 * Next cue after `current`, using the SHARED `nextPreviewPosition` skip walk
 * over the plan's items (so empty/header items are stepped over identically to
 * the operator shells). Returns null at the end of the sheet.
 */
export function nextCue(
  plan: ExpandedPlan,
  sheet: CueEntry[],
  current: NavPosition,
): CueEntry | null {
  const pos = nextPreviewPosition(plan.items, current, 1);
  if (pos.itemIdx === current.itemIdx && pos.slideIdx === current.slideIdx) return null;
  return cueAt(sheet, pos);
}

/** Previous cue before `current` (shared skip walk). Returns null at the start. */
export function prevCue(
  plan: ExpandedPlan,
  sheet: CueEntry[],
  current: NavPosition,
): CueEntry | null {
  const pos = nextPreviewPosition(plan.items, current, -1);
  if (pos.itemIdx === current.itemIdx && pos.slideIdx === current.slideIdx) return null;
  return cueAt(sheet, pos);
}
