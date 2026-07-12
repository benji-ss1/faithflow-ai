"use client";
import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";

export function LibrarySection() {
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
          <span className="eyebrow">Library</span>
        </button>
        <button
          type="button"
          data-todo="1"
          className="w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--color-elevated)] text-[var(--color-muted-foreground)]"
          title="Add library (coming soon)"
        >
          <Plus className="w-3 h-3" />
        </button>
      </header>
      {open && (
        <ul className="pb-1">
          <li>
            <button
              type="button"
              className={cn(
                "w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left",
                "border-l-2 border-[var(--color-brand)] bg-[var(--color-elevated)] text-[var(--color-foreground)]",
              )}
            >
              <BookOpen className="w-3.5 h-3.5" />
              Default
            </button>
          </li>
        </ul>
      )}
    </section>
  );
}
