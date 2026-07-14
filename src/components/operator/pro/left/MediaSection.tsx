"use client";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { CenterMode } from "../ProOperatorShell";

const CATEGORIES = ["Cinematic", "Free", "Creators", "Intro Videos"];

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
          {CATEGORIES.map((c) => (
            <li key={c}>
              <button
                type="button"
                title={`Browse ${c}`}
                onClick={() => onCenterMode?.("media")}
                className="w-full text-left px-2 py-1 text-[12px] text-[var(--color-muted-foreground)] hover:bg-white/5 hover:text-[var(--color-foreground)]"
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
