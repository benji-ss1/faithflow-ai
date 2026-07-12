"use client";
import { Download, Play, Pause } from "lucide-react";

export function AudioTab() {
  return (
    <div className="flex flex-col gap-3">
      <div className="eyebrow">Playlist</div>
      <div className="text-[var(--color-muted-foreground)] py-4 text-center">
        No audio items yet. Coming soon.
      </div>
      <button
        data-todo="1"
        className="w-full h-9 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-elevated)] flex items-center justify-center gap-2"
      >
        <Download className="w-4 h-4" /> Import Audio
      </button>
      <div className="border-t border-[var(--color-border)] pt-2 flex items-center gap-2">
        <button data-todo="1" className="w-8 h-8 rounded-md hover:bg-[var(--color-elevated)] flex items-center justify-center"><Play className="w-4 h-4" /></button>
        <button data-todo="1" className="w-8 h-8 rounded-md hover:bg-[var(--color-elevated)] flex items-center justify-center"><Pause className="w-4 h-4" /></button>
        <input type="range" className="flex-1" defaultValue="0" />
      </div>
    </div>
  );
}
