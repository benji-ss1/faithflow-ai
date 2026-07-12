"use client";
import { toast } from "sonner";
import { LayoutGrid, List, Eye, Play, Music, BookOpen, Image as ImageIcon } from "lucide-react";
import type { OperatorShellCtx } from "../../shell/types";
import type { CenterMode } from "../ProOperatorShell";

// Y5: mirror SlideGrid's Safe Mode source of truth.
const SAFE_MODE_KEY = "presentflow.operator.safeMode";
function safeMode() {
  if (typeof window === "undefined") return true;
  const raw = window.localStorage.getItem(SAFE_MODE_KEY);
  return raw !== "0";
}

export function CenterHeader({ ctx, centerMode }: { ctx: OperatorShellCtx; centerMode: CenterMode }) {
  const item = ctx.plan.items[ctx.previewItemIdx];
  // R6/Y4: mode-aware titles. Read-only per the earlier decision — rename
  // routes through the item edit flow in slides mode only.
  const Icon =
    centerMode === "bible" ? BookOpen
    : centerMode === "songs" ? Music
    : centerMode === "media" ? ImageIcon
    : item?.type === "song" ? Music
    : LayoutGrid;
  const title =
    centerMode === "bible" ? "Bible"
    : centerMode === "songs" ? "Songs Library"
    : centerMode === "media" ? "Media Library"
    : (item?.title ?? "No item selected");
  const isLibraryMode = centerMode === "songs" || centerMode === "media" || centerMode === "bible";

  return (
    <div className="h-11 shrink-0 border-b border-[var(--color-border)] flex items-center px-3 gap-2">
      <Icon className="w-4 h-4 text-[var(--color-muted-foreground)]" />
      {/* R6/Y4: item-title editing not yet wired to a server action; render
          read-only so keystrokes aren't silently dropped. When rename lands,
          switch to a controlled input backed by renameServiceItem(). */}
      <input
        key={item?.id ?? "no-item"}
        type="text"
        value={title}
        readOnly
        onClick={() => {
          if (!isLibraryMode) toast.info("Rename coming soon");
        }}
        title={isLibraryMode ? undefined : "Rename coming soon"}
        className="flex-1 bg-transparent text-[14px] font-medium outline-none px-2 py-1 rounded cursor-default"
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
            if (!s) return;
            // Y5: match SlideGrid — Safe Mode ON = select-only, not live.
            if (safeMode()) {
              ctx.onJumpSlide(ctx.previewItemIdx, 0);
            } else {
              ctx.onSendSlideToLive(s);
            }
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
