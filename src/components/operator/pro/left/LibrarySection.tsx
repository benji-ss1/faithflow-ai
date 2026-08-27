"use client";
import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, ChevronRight, Plus, BookOpen, Music, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CenterMode } from "../ProOperatorShell";

export function LibrarySection({ onCenterMode }: { onCenterMode?: (m: CenterMode) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="border-b border-[var(--color-border)]">
      <header className="flex items-center h-8 px-2.5 gap-2 bg-[linear-gradient(180deg,var(--color-panel),transparent)]">
        <button
          type="button"
          className="flex items-center gap-1 shrink-0 text-left"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <span className="eyebrow">Library</span>
        </button>
        <span className="h-px flex-1" style={{ background: "linear-gradient(90deg, var(--color-border), transparent)" }} aria-hidden />
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className="w-[22px] h-[22px] grid place-items-center rounded-md border border-[var(--color-border)] bg-[var(--color-card)] shadow-[var(--edge-top),var(--shadow-sm)] text-[var(--color-muted-foreground)] transition-[transform,box-shadow,color,border-color] duration-200 [transition-timing-function:var(--ease-spring)] hover:-translate-y-px hover:text-[var(--color-brand)] hover:border-[color-mix(in_oklab,var(--color-brand)_50%,var(--color-border))] active:translate-y-0 active:scale-95"
              title="Add"
            >
              <Plus className="w-3.5 h-3.5" strokeWidth={2.4} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              side="right"
              align="start"
              className="rounded-xl bg-[var(--color-elevated)] border border-[var(--color-border)] p-1.5 text-[12.5px] shadow-[var(--edge-top),var(--shadow-lg)] z-50 min-w-[152px]"
            >
              <DropdownMenu.Item onSelect={() => onCenterMode?.("songs")} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg font-medium outline-none cursor-pointer transition-colors data-[highlighted]:bg-[var(--color-brand)]/12 data-[highlighted]:text-[var(--color-brand)]"><Music className="w-3.5 h-3.5 shrink-0 opacity-70" />From Songs</DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => onCenterMode?.("bible")} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg font-medium outline-none cursor-pointer transition-colors data-[highlighted]:bg-[var(--color-brand)]/12 data-[highlighted]:text-[var(--color-brand)]"><BookOpen className="w-3.5 h-3.5 shrink-0 opacity-70" />From Bible</DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => onCenterMode?.("media")} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg font-medium outline-none cursor-pointer transition-colors data-[highlighted]:bg-[var(--color-brand)]/12 data-[highlighted]:text-[var(--color-brand)]"><ImageIcon className="w-3.5 h-3.5 shrink-0 opacity-70" />From Media</DropdownMenu.Item>
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
                "w-full flex items-center gap-2 px-2.5 py-1.5 text-[12.5px] font-semibold text-left rounded-md border-l-[3px] border-[var(--color-brand)] transition-colors",
                "bg-[var(--color-elevated)] text-[var(--color-foreground)] shadow-[var(--edge-top)] hover:bg-[var(--color-raised-shell)]",
              )}
            >
              <BookOpen className="w-4 h-4 text-[var(--color-brand)]" />
              Default
            </button>
          </li>
        </ul>
      )}
    </section>
  );
}
