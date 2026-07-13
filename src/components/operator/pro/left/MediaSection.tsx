"use client";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { CenterMode } from "../ProOperatorShell";

const CATEGORIES = ["Cinematic", "Free", "Creators", "Intro Videos", "Playlists", "Video Inputs"];

export function MediaSection({ onCenterMode }: { onCenterMode?: (m: CenterMode) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="border-b border-[var(--color-border)]">
      <header className="flex items-center h-7 px-2 gap-1">
        <button
          type="button"
          className="flex items-center gap-1 flex-1 text-left"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <span className="eyebrow">Media</span>
        </button>
      </header>
      {open && (
        <ul className="pb-1">
          {CATEGORIES.map((c) => {
            const isVideoInputs = c === "Video Inputs";
            const isPlaylists = c === "Playlists";
            const soon = isVideoInputs || isPlaylists;
            return (
              <li key={c}>
                <button
                  type="button"
                  data-todo={soon ? "1" : undefined}
                  disabled={soon}
                  title={soon ? `${c} — coming soon` : `Browse ${c}`}
                  onClick={() => !soon && onCenterMode?.("media")}
                  className="w-full text-left px-2 py-1 text-[12px] text-[var(--color-muted-foreground)] hover:bg-white/5 hover:text-[var(--color-foreground)] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {c}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
