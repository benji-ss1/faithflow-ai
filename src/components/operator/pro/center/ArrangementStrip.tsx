"use client";
/**
 * ArrangementStrip — the operator's "see it thoroughly" surface for Groups &
 * Arrangements (wave 6D). A slim strip ABOVE the slide grid that renders the
 * previewed song's arrangement as a row of colour-coded group chips:
 *  - the block containing the current preview slide is highlighted;
 *  - clicking a chip jumps the grid to that block's first slide (PREVIEW only —
 *    never projects; mirrors the grid's own onJumpSlide select behaviour);
 *  - when an arrangement is PINNED, a "+" appends a group and an "×" removes a
 *    specific instance, LIVE mid-service (persisted via reorderArrangement). These
 *    reflow the preview/grid only — the live projector is untouched until the
 *    operator sends a slide, so a live output is never disturbed;
 *  - "Edit arrangement" opens the full editor on the song page (v1).
 *
 * Renders NOTHING for a groupless song (loader omits slideGroupIds/groups) — the
 * no-regression line: a song that never adopted groups looks exactly as today.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import * as Popover from "@radix-ui/react-popover";
import { Plus, X, Pencil, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { groupColor } from "@/engine/arrangements";
import { computeArrangementBlocks, blockAtSlide } from "@/lib/arrangement-strip";
import { reorderArrangement } from "@/lib/actions";
import type { OperatorShellCtx } from "../../shell/types";

export function ArrangementStrip({ ctx }: { ctx: OperatorShellCtx }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const item = ctx.plan.items[ctx.previewItemIdx];

  const groups = item?.groups;
  const slideGroupIds = item?.slideGroupIds;
  const pinnedId = item?.arrangementId;
  const pinned = pinnedId ? item?.arrangements?.find((a) => a.id === pinnedId) : undefined;

  const groupById = useMemo(
    () => new Map((groups ?? []).map((g) => [g.id, g])),
    [groups],
  );

  const blocks = useMemo(
    () => (slideGroupIds ? computeArrangementBlocks(slideGroupIds, pinned?.order ?? null) : []),
    [slideGroupIds, pinned],
  );

  // No groups on this song → render nothing (no-regression).
  if (!item || item.type !== "song" || !slideGroupIds || !groups || groups.length === 0) return null;
  if (blocks.length === 0) return null;

  const activeBlock = blockAtSlide(blocks, ctx.previewSlideIdx);
  const canEditLive = !!pinned; // +/× only meaningful against a real arrangement order

  const persistOrder = async (nextOrder: string[]) => {
    if (!pinned) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      toast.error("You're offline — reconnect to change the arrangement.");
      return;
    }
    setBusy(true);
    try {
      const res = await reorderArrangement(pinned.id, nextOrder);
      if (!res.ok) { toast.error(res.error ?? "Couldn't update the arrangement"); return; }
      router.refresh(); // reflow preview/grid; live output stays until the operator sends
    } finally {
      setBusy(false);
    }
  };

  const appendGroup = (groupId: string) => {
    if (!pinned) return;
    void persistOrder([...pinned.order, groupId]);
  };

  const removeInstance = (orderIndex: number | null) => {
    if (!pinned || orderIndex == null) return;
    const next = pinned.order.filter((_, i) => i !== orderIndex);
    void persistOrder(next);
  };

  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-panel)]/40 overflow-x-auto">
      <span className="shrink-0 flex items-center gap-1 pr-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
        <Layers className="w-3 h-3" />
        {pinned ? pinned.name : "Master"}
      </span>

      {blocks.map((b, i) => {
        const g = groupById.get(b.groupId);
        if (!g) return null;
        const color = groupColor({ kind: g.kind, color: g.color });
        const isActive = i === activeBlock;
        return (
          <span key={`${b.groupId}-${i}`} className="shrink-0 inline-flex items-center">
            <button
              type="button"
              onClick={() => ctx.onJumpSlide(ctx.previewItemIdx, b.startSlide)}
              title={`${g.name || g.kind} — jump to slide ${b.startSlide + 1}`}
              className={cn(
                "inline-flex items-center gap-1 h-6 pl-2 rounded-l-md text-[11px] font-semibold text-white transition-[filter,box-shadow]",
                canEditLive ? "" : "rounded-r-md pr-2",
                isActive ? "ring-2 ring-white/70 shadow-[0_0_0_1px_rgba(0,0,0,0.3)]" : "opacity-80 hover:opacity-100",
              )}
              style={{ background: color }}
            >
              <span className="max-w-[120px] truncate">{g.name || g.kind}</span>
            </button>
            {canEditLive && (
              <button
                type="button"
                disabled={busy}
                onClick={() => removeInstance(b.orderIndex)}
                title="Remove this group from the arrangement"
                className="inline-flex items-center justify-center h-6 w-5 rounded-r-md text-white/90 hover:text-white transition-colors disabled:opacity-50"
                style={{ background: color, filter: "brightness(0.82)" }}
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </span>
        );
      })}

      {/* Live add a group to the current arrangement (pinned only). */}
      {canEditLive && (
        <Popover.Root>
          <Popover.Trigger asChild>
            <button
              type="button"
              disabled={busy}
              title="Add a group to this arrangement"
              className="shrink-0 inline-flex items-center justify-center h-6 w-6 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted-foreground)] hover:text-[var(--color-brand)] hover:border-[var(--color-brand)] transition-colors disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content side="bottom" align="start" sideOffset={4} className="rounded-lg bg-[var(--color-elevated)] border border-[var(--color-border)] p-1 text-[12px] shadow-lg z-50 min-w-[150px] max-h-[280px] overflow-y-auto">
              <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-[var(--color-muted-foreground)]">Add group</div>
              {[...groups].sort((a, b) => a.order - b.order).map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => appendGroup(g.id)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left hover:bg-[var(--color-panel)]"
                >
                  <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: groupColor({ kind: g.kind, color: g.color }) }} />
                  <span className="truncate">{g.name || g.kind}</span>
                </button>
              ))}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}

      {/* Edit arrangement — opens the full Groups & Arrangements editor (v1: the
          song page). Additive; never blocks the operator. */}
      {item.songId && (
        <a
          href={`/library/songs/${item.songId}`}
          target="_blank"
          rel="noreferrer"
          title="Open the full Groups & Arrangements editor"
          className="shrink-0 ml-auto inline-flex items-center gap-1 h-6 px-2 rounded-md text-[10px] font-semibold text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-panel)] transition-colors"
        >
          <Pencil className="w-3 h-3" /> Edit
        </a>
      )}
    </div>
  );
}
