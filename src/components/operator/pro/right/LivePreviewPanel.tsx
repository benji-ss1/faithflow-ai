"use client";
import { X } from "lucide-react";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import type { OperatorShellCtx } from "../../shell/types";

export function LivePreviewPanel({ ctx }: { ctx: OperatorShellCtx }) {
  const isLive = ctx.liveSlide.kind !== "empty";
  return (
    <div className="p-2 flex flex-col gap-2">
      <div
        className={
          isLive
            ? "relative aspect-video rounded-md overflow-hidden border-2 border-[color:var(--color-destructive,#e11d48)] bg-black"
            : "relative aspect-video rounded-md overflow-hidden border border-[var(--color-border)] bg-black"
        }
      >
        {isLive && (
          <div className="absolute top-1 left-1 z-10 text-[9px] font-mono uppercase tracking-wider text-white bg-[color:var(--color-destructive,#e11d48)] px-1.5 py-0.5 rounded">
            LIVE
          </div>
        )}
        <SlideRenderer slide={ctx.liveSlide} />
        {ctx.liveSlide.kind !== "empty" && (
          <button
            onClick={ctx.onKill}
            className="absolute top-1 right-1 w-6 h-6 flex items-center justify-center rounded bg-black/60 text-white hover:bg-[var(--color-destructive)]"
            title="Clear live"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        <div className="absolute bottom-1 left-1 text-[9px] font-mono uppercase tracking-wider text-white/70 bg-black/50 px-1 rounded">
          Live
        </div>
      </div>
      <div className="flex items-center gap-2">
        <select className="flex-1 h-7 px-2 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded text-[11px]">
          <option>Screen 1</option>
          <option>Projector</option>
          <option>Stage</option>
          <option>Livestream</option>
        </select>
        <div className="flex items-center gap-1">
          {["16/9", "4/3", "…"].map((l) => (
            <button
              key={l}
              data-todo="1"
              className="h-7 px-1.5 text-[10px] font-mono rounded border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            >{l}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
