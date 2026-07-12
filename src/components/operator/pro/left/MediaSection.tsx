"use client";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

const CATEGORIES = ["Cinematic", "Free", "Creators", "Intro Videos", "Playlists", "Video Inputs"];

export function MediaSection() {
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
          {CATEGORIES.map((c) => (
            <li key={c}>
              <button
                type="button"
                data-todo="1"
                title={`${c} — coming soon`}
                className="w-full text-left px-3 py-1.5 text-[12px] text-[var(--color-muted-foreground)] hover:bg-[var(--color-elevated)] hover:text-[var(--color-foreground)]"
              >
                {c}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
