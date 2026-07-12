"use client";
import { Plus, Pause, Play, SkipForward, SkipBack, ChevronDown, LayoutGrid, List, Type, Smile, SlidersHorizontal } from "lucide-react";
import type { OperatorShellCtx } from "../shell/types";

export function BottomBar({
  ctx, slideSize, onSlideSize,
}: {
  ctx: OperatorShellCtx;
  slideSize: number;
  onSlideSize: (n: number) => void;
}) {
  return (
    <div className="h-10 shrink-0 border-t border-[var(--color-border)] bg-[var(--color-panel)] flex items-center px-2 gap-2">
      {/* Left */}
      <div className="flex items-center gap-1">
        <button data-todo="1" className="w-7 h-7 flex items-center justify-center rounded hover:bg-[var(--color-elevated)] text-[var(--color-muted-foreground)]"><Plus className="w-4 h-4" /></button>
        <button data-todo="1" className="w-7 h-7 flex items-center justify-center rounded hover:bg-[var(--color-elevated)] text-[var(--color-muted-foreground)]"><Pause className="w-4 h-4" /></button>
        <button data-todo="1" className="w-7 h-7 flex items-center justify-center rounded hover:bg-[var(--color-elevated)] text-[var(--color-muted-foreground)]"><Play className="w-4 h-4" /></button>
        <button data-todo="1" className="w-7 h-7 flex items-center justify-center rounded hover:bg-[var(--color-elevated)] text-[var(--color-muted-foreground)]"><SkipBack className="w-4 h-4" /></button>
        <button data-todo="1" className="w-7 h-7 flex items-center justify-center rounded hover:bg-[var(--color-elevated)] text-[var(--color-muted-foreground)]"><SkipForward className="w-4 h-4" /></button>
        <button data-todo="1" className="h-7 px-2 rounded text-[11px] flex items-center gap-1 border border-[var(--color-border)]">
          Save As <ChevronDown className="w-3 h-3" />
        </button>
      </div>

      {/* Center */}
      <div className="flex-1 flex items-center justify-center gap-2 text-[11px] text-[var(--color-muted-foreground)]">
        <button
          onClick={() => { const i = ctx.previewSlideIdx - 1; if (i >= 0) ctx.onJumpSlide(ctx.previewItemIdx, i); }}
          className="h-7 px-2 rounded hover:bg-[var(--color-elevated)]"
        >
          &lt; Verse
        </button>
        <span className="font-mono">Amoeba: 0.6s</span>
        <button
          onClick={() => {
            const item = ctx.plan.items[ctx.previewItemIdx];
            const i = ctx.previewSlideIdx + 1;
            if (item && i < item.slides.length) ctx.onJumpSlide(ctx.previewItemIdx, i);
          }}
          className="h-7 px-2 rounded hover:bg-[var(--color-elevated)]"
        >
          Verse &gt;
        </button>
      </div>

      {/* Right */}
      <div className="flex items-center gap-2">
        <div className="inline-flex rounded border border-[var(--color-border)] overflow-hidden">
          <button data-todo="1" className="w-7 h-7 flex items-center justify-center text-[var(--color-muted-foreground)]"><LayoutGrid className="w-3.5 h-3.5" /></button>
          <button data-todo="1" className="w-7 h-7 flex items-center justify-center text-[var(--color-muted-foreground)] border-l border-[var(--color-border)]"><List className="w-3.5 h-3.5" /></button>
          <button data-todo="1" className="w-7 h-7 flex items-center justify-center text-[var(--color-muted-foreground)] border-l border-[var(--color-border)]"><Type className="w-3.5 h-3.5" /></button>
        </div>
        <button data-todo="1" className="w-7 h-7 flex items-center justify-center rounded hover:bg-[var(--color-elevated)] text-[var(--color-muted-foreground)]"><Smile className="w-4 h-4" /></button>
        <input
          type="range"
          min={96}
          max={240}
          value={slideSize}
          onChange={(e) => onSlideSize(parseInt(e.target.value, 10))}
          className="w-24 accent-[var(--color-brand)]"
          title={`Slide size: ${slideSize}px`}
        />
        <button data-todo="1" className="w-7 h-7 flex items-center justify-center rounded hover:bg-[var(--color-elevated)] text-[var(--color-muted-foreground)]"><SlidersHorizontal className="w-4 h-4" /></button>
      </div>
    </div>
  );
}
