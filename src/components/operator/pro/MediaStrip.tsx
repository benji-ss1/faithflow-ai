"use client";
import { ChevronRight } from "lucide-react";

export function MediaStrip() {
  return (
    <div className="h-[140px] shrink-0 border-t border-[var(--color-border)] bg-[var(--color-panel)] flex flex-col">
      <div className="h-6 px-3 flex items-center gap-1 text-[11px] text-[var(--color-muted-foreground)] border-b border-[var(--color-border)]">
        <span>Playlists</span>
        <ChevronRight className="w-3 h-3" />
        <span>Playlist</span>
      </div>
      <div className="flex-1 min-h-0 flex items-center gap-2 px-3 overflow-x-auto">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            data-todo="1"
            className="shrink-0 w-[160px] h-[90px] rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] flex items-center justify-center text-[11px] text-[var(--color-muted-foreground)]"
          >
            {i === 0 ? "Input 1" : "Media"}
          </div>
        ))}
      </div>
      <div className="h-6 px-3 flex items-center justify-end text-[10px] text-[var(--color-muted-foreground)] border-t border-[var(--color-border)]">
        <button data-todo="1">Filter</button>
      </div>
    </div>
  );
}
