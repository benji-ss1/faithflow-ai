"use client";
/**
 * ArrangementStrip — the operator's "see + drive" surface for Groups &
 * Arrangements (wave 6D, expanded in 6G). A slim strip ABOVE the slide grid.
 *
 * 6G change (field rec12 — "there should be arrangements for everything… where's
 * Add group? how do I make this the bridge?"): the strip now renders for ANY
 * previewed SONG, not just one that already has groups. When a song has no
 * sections yet it shows an honest empty state with an "Add sections" call to
 * action; the "Manage sections" popover embeds the full Groups & Arrangements
 * editor inline (compact) so the operator never has to leave the shell to build
 * groups + arrangements. Everything persists via the existing server actions and
 * the grid/strip reflow live (router.refresh); the projector is untouched until
 * the operator sends a slide.
 *
 * When a song HAS groups the strip renders its arrangement as a row of
 * colour-coded group chips:
 *  - the block containing the current preview slide is highlighted;
 *  - clicking a chip jumps the grid to that block's first slide (PREVIEW only —
 *    never projects);
 *  - when an arrangement is PINNED, a "+" appends a group and an "×" removes a
 *    specific instance, LIVE mid-service (persisted via reorderArrangement).
 *
 * Renders NOTHING for a non-song item (no-regression for scripture/media/etc.).
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import * as Popover from "@radix-ui/react-popover";
import { Plus, X, Layers, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { groupColor } from "@/engine/arrangements";
import { computeArrangementBlocks, blockAtSlide } from "@/lib/arrangement-strip";
import { reorderArrangement } from "@/lib/actions";
import { SongArrangements } from "@/components/library/SongArrangements";
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

  // Only songs get an arrangement strip. Non-song items render nothing.
  if (!item || item.type !== "song" || !item.songId) return null;

  const hasGroups = !!groups && groups.length > 0;
  const activeBlock = blockAtSlide(blocks, ctx.previewSlideIdx);
  const canEditLive = !!pinned; // +/× only meaningful against a real arrangement order

  // Slides for the inline manager (compact SongArrangements). songSlideRows is
  // the expanded per-slide row list the loader carries for song items.
  const managerSlides = (item.songSlideRows ?? []).map((r) => ({ id: r.id, lyrics: r.lyrics }));

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

  // The inline "Manage sections" popover — embeds the full editor compactly so
  // the operator builds groups + arrangements WITHOUT leaving the shell.
  const managePopover = (label: string) => (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="shrink-0 inline-flex items-center gap-1 h-6 px-2 rounded-md text-[10px] font-semibold text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-panel)] border border-[var(--color-border)] transition-colors"
          title="Create and manage this song's sections and arrangements"
        >
          <Layers className="w-3 h-3" /> {label}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className="rounded-xl bg-[var(--color-elevated)] border border-[var(--color-border)] p-4 shadow-2xl z-50 w-[min(92vw,560px)] max-h-[70vh] overflow-y-auto"
        >
          <div className="mb-3 flex items-center gap-2">
            <Layers className="w-4 h-4 text-[var(--color-brand)]" />
            <h3 className="text-sm font-semibold text-[var(--color-foreground)]">Sections &amp; arrangements</h3>
            <span className="text-[11px] text-[var(--color-muted-foreground)]">Changes apply live — the projector stays put until you send a slide.</span>
          </div>
          {item.songId && (
            <SongArrangements
              songId={item.songId}
              slides={managerSlides}
              onChanged={() => router.refresh()}
            />
          )}
          <Popover.Close asChild>
            <button type="button" className="mt-4 h-8 px-3 rounded-md text-[12px] font-medium bg-[var(--color-panel)] border border-[var(--color-border)] hover:bg-[var(--color-card)]">
              Done
            </button>
          </Popover.Close>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );

  // ── Empty state: a song with no sections yet ────────────────────────────────
  if (!hasGroups) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-panel)]/40">
        <span className="shrink-0 flex items-center gap-1 pr-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
          <Layers className="w-3 h-3" /> Sections
        </span>
        <span className="text-[11px] text-[var(--color-muted-foreground)] truncate">
          No sections yet — add sections (Verse, Chorus, Bridge…) to build arrangements.
        </span>
        <div className="ml-auto shrink-0">{managePopover("Add sections")}</div>
      </div>
    );
  }

  // ── Populated state: chips for the arrangement/master order ─────────────────
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
              {[...groups!].sort((a, b) => a.order - b.order).map((g) => (
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

      {/* Known-limit mitigation (wave 6G): a quick-edit that ADDS or REMOVES a
          line rewrites the slide list and can't positionally match sections, so
          groups reset. An in-place edit that keeps the line count preserves them
          (updateSongSlides index-match). Surface it so there's no silent loss. */}
      <span
        className="shrink-0 ml-1 inline-flex items-center gap-1 text-[9px] font-medium text-[var(--color-muted-foreground)]/80"
        title="Sections are preserved when you edit a line in place. Adding or removing lines in quick-edit can reset a slide's section — re-tag it from the slide's right-click menu."
      >
        <AlertTriangle className="w-3 h-3" />
      </span>

      {/* Manage sections + arrangements inline (no leaving the shell). */}
      <div className="shrink-0 ml-auto pl-1">{managePopover("Manage sections")}</div>
    </div>
  );
}
