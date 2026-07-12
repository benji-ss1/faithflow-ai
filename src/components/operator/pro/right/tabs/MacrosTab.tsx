"use client";
import { Plus } from "lucide-react";

export function MacrosTab() {
  return (
    <div className="flex flex-col gap-3">
      <button data-todo="1" className="h-9 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-elevated)] flex items-center justify-center gap-2">
        <Plus className="w-4 h-4" /> Add Macro
      </button>
      <div className="text-[var(--color-muted-foreground)] py-6 text-center">
        No macros yet. Coming soon.
      </div>
      <div className="eyebrow text-right">0 items</div>
    </div>
  );
}
