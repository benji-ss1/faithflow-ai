"use client";
import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, ChevronRight, Plus, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CenterMode } from "../ProOperatorShell";

export function LibrarySection({ onCenterMode }: { onCenterMode?: (m: CenterMode) => void }) {
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
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/5 text-[var(--color-muted-foreground)]"
              title="Add"
            >
              <Plus className="w-3 h-3" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              side="right"
              align="start"
              className="rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-1 text-[12px] shadow-lg z-50 min-w-[140px]"
            >
              <DropdownMenu.Item onSelect={() => onCenterMode?.("songs")} className="px-3 py-1.5 rounded hover:bg-white/5 outline-none cursor-pointer">From Songs</DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => onCenterMode?.("bible")} className="px-3 py-1.5 rounded hover:bg-white/5 outline-none cursor-pointer">From Bible</DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => onCenterMode?.("media")} className="px-3 py-1.5 rounded hover:bg-white/5 outline-none cursor-pointer">From Media</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </header>
      {open && (
        <ul className="pb-1">
          <li>
            <button
              type="button"
              onClick={() => onCenterMode?.("slides")}
              title="Return to the current service plan's slide view"
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1 text-[12px] text-left transition-colors",
                "border-l-2 border-[var(--color-brand)] bg-[var(--color-elevated)] text-[var(--color-foreground)] hover:bg-[var(--color-panel)]",
              )}
            >
              <BookOpen className="w-4 h-4" />
              Default
            </button>
          </li>
        </ul>
      )}
    </section>
  );
}
