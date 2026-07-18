"use client";
import { useEffect, useState } from "react";
import { LayoutGrid, List, Eye, Play, Music, BookOpen, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OperatorShellCtx } from "../../shell/types";
import type { CenterMode } from "../ProOperatorShell";

// Y5: mirror SlideGrid's Safe Mode source of truth.
const SAFE_MODE_KEY = "presentflow.operator.safeMode";
function safeMode() {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(SAFE_MODE_KEY);
  return raw === "1"; // default OFF per user directive
}

const VIEW_MODE_KEY = "presentflow.operator.slideViewMode";
type ViewMode = "grid" | "list" | "text";

export function CenterHeader({
  ctx,
  centerMode,
  slideSize,
  onSlideSize,
}: {
  ctx: OperatorShellCtx;
  centerMode: CenterMode;
  slideSize?: number;
  onSlideSize?: (n: number) => void;
}) {
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

  return (
    <div className="h-11 shrink-0 border-b border-[var(--color-border)] flex items-center px-3 gap-2">
      <Icon className="w-4 h-4 text-[var(--color-muted-foreground)]" />
      {/* Item title is read-only; edit via the library entry. */}
      <div
        className="flex-1 text-[14px] font-medium px-2 py-1 truncate"
        title={title}
      >
        {title}
      </div>
      {typeof slideSize === "number" && onSlideSize && centerMode === "slides" && (
        <div className="flex items-center gap-2 pr-2" title={`Slide size: ${slideSize}px`}>
          <input
            type="range"
            min={96}
            max={240}
            value={slideSize}
            onChange={(e) => onSlideSize(parseInt(e.target.value, 10))}
            className="w-[150px]"
            style={{ accentColor: "#5b9bd5" }}
            aria-label="Slide size"
          />
        </div>
      )}
      <ViewModeToggle />
      <button className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/5 text-[var(--color-muted-foreground)]" title="Preview (open Live in a new window)"
        onClick={() => { try { window.open("/live", "presentflow-live", "width=1280,height=720"); } catch { /* noop */ } }}
      >
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
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/5 text-[var(--color-brand)]"
          title="Play first slide (respects Safe Mode)"
        >
          <Play className="w-4 h-4" />
        </button>
    </div>
  );
}

function ViewModeToggle() {
  const [mode, setMode] = useState<ViewMode>("grid");
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(VIEW_MODE_KEY);
      if (raw === "grid" || raw === "list" || raw === "text") setMode(raw);
    } catch { /* noop */ }
    const handler = (e: Event) => {
      const d = (e as CustomEvent<ViewMode>).detail;
      if (d === "grid" || d === "list" || d === "text") setMode(d);
    };
    window.addEventListener("presentflow:slide-view-mode", handler);
    return () => window.removeEventListener("presentflow:slide-view-mode", handler);
  }, []);
  const set = (m: ViewMode) => {
    setMode(m);
    try { window.localStorage.setItem(VIEW_MODE_KEY, m); } catch { /* noop */ }
    try { window.dispatchEvent(new CustomEvent("presentflow:slide-view-mode", { detail: m })); } catch { /* noop */ }
  };
  return (
    <div className="flex items-center rounded border border-[var(--color-border)] overflow-hidden">
      <button title="Grid view" aria-pressed={mode === "grid"} onClick={() => set("grid")}
        className={cn("w-7 h-7 flex items-center justify-center hover:bg-white/5",
          mode === "grid" ? "text-[var(--color-foreground)] bg-white/5" : "text-[var(--color-muted-foreground)]")}>
        <LayoutGrid className="w-4 h-4" />
      </button>
      <button title="List view" aria-pressed={mode === "list"} onClick={() => set("list")}
        className={cn("w-7 h-7 flex items-center justify-center border-l border-[var(--color-border)] hover:bg-white/5",
          mode === "list" ? "text-[var(--color-foreground)] bg-white/5" : "text-[var(--color-muted-foreground)]")}>
        <List className="w-4 h-4" />
      </button>
    </div>
  );
}
