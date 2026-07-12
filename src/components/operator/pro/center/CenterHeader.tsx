"use client";
import { LayoutGrid, List, Eye, Play, Music, BookOpen } from "lucide-react";
import type { OperatorShellCtx } from "../../shell/types";
import type { CenterMode } from "../ProOperatorShell";

export function CenterHeader({ ctx, centerMode }: { ctx: OperatorShellCtx; centerMode: CenterMode }) {
  const item = ctx.plan.items[ctx.previewItemIdx];
  const Icon = centerMode === "bible" ? BookOpen : item?.type === "song" ? Music : LayoutGrid;
  const title = centerMode === "bible" ? "Bible" : item?.title ?? "No item selected";

  return (
    <div className="h-11 shrink-0 border-b border-[var(--color-border)] flex items-center px-3 gap-2">
      <Icon className="w-4 h-4 text-[var(--color-muted-foreground)]" />
      <input
        type="text"
        defaultValue={title}
        className="flex-1 bg-transparent text-[14px] font-medium outline-none focus:bg-[var(--color-elevated)] px-2 py-1 rounded"
      />
      <div className="flex items-center gap-1">
        <button className="w-7 h-7 flex items-center justify-center rounded hover:bg-[var(--color-elevated)] text-[var(--color-muted-foreground)]" title="Grid">
          <LayoutGrid className="w-4 h-4" />
        </button>
        <button className="w-7 h-7 flex items-center justify-center rounded hover:bg-[var(--color-elevated)] text-[var(--color-muted-foreground)]" title="List">
          <List className="w-4 h-4" />
        </button>
        <button className="w-7 h-7 flex items-center justify-center rounded hover:bg-[var(--color-elevated)] text-[var(--color-muted-foreground)]" title="Preview">
          <Eye className="w-4 h-4" />
        </button>
        <button
          onClick={() => {
            const s = ctx.plan.items[ctx.previewItemIdx]?.slides[0];
            if (s) ctx.onSendSlideToLive(s);
          }}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-[var(--color-elevated)] text-[var(--color-brand)]"
          title="Play first slide (respects Safe Mode)"
        >
          <Play className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
