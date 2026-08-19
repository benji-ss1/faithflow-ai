"use client";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type DisclosureItem = {
  id: string;
  /** Primary label (bold). */
  name: string;
  /** Secondary line (muted). */
  description?: string;
  /** Small trailing badge, e.g. "PRO". */
  badge?: string;
  icon?: ReactNode;
  disabled?: boolean;
};

/**
 * DropdownDisclosure — a rich single-select dropdown (adapted from the requested
 * reference to this app's stack): a compact trigger showing the current choice,
 * and a disclosure panel of options each with name + description + optional
 * badge. Built on Radix Popover for positioning / outside-click / focus.
 */
export function DropdownDisclosure({
  items, selectedId, onSelect, align = "start", triggerClassName, panelWidth = 250,
}: {
  items: DisclosureItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  align?: "start" | "center" | "end";
  triggerClassName?: string;
  panelWidth?: number;
}) {
  const selected = items.find((i) => i.id === selectedId);

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            "h-9 px-2.5 inline-flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] text-[13px] font-medium text-[var(--color-foreground)] hover:border-[var(--color-brand)]/50 transition-colors",
            triggerClassName,
          )}
        >
          {selected?.icon && <span className="shrink-0 grid place-items-center text-[var(--color-muted-foreground)]">{selected.icon}</span>}
          <span className="truncate max-w-[140px]">{selected?.name ?? "Select"}</span>
          <ChevronDown className="w-3.5 h-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align={align}
          sideOffset={6}
          className="z-[60] rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-1 shadow-2xl animate-in fade-in slide-in-from-top-1 duration-150 max-h-[60vh] overflow-y-auto"
          style={{ width: panelWidth, boxShadow: "0 18px 50px rgba(0,0,0,0.55)" }}
        >
          {items.map((i) => {
            const active = i.id === selectedId;
            return (
              <Popover.Close asChild key={i.id}>
                <button
                  type="button"
                  disabled={i.disabled}
                  onClick={() => { if (!i.disabled) onSelect(i.id); }}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors disabled:opacity-45 disabled:cursor-not-allowed",
                    active ? "bg-[var(--color-elevated)]" : "hover:bg-white/[0.05]",
                  )}
                >
                  {i.icon && (
                    <span className="shrink-0 grid h-7 w-7 place-items-center rounded-md bg-[var(--color-elevated)] text-[var(--color-muted-foreground)]">{i.icon}</span>
                  )}
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className={cn("text-[13px] font-semibold truncate", active ? "text-[var(--color-foreground)]" : "text-[var(--color-foreground)]/90")}>{i.name}</span>
                      {i.badge && (
                        <span className="shrink-0 text-[9px] font-mono font-bold uppercase tracking-wide px-1.5 py-px rounded" style={{ background: "var(--color-brand)", color: "#17130c" }}>{i.badge}</span>
                      )}
                    </span>
                    {i.description && <span className="block text-[11px] leading-tight text-[var(--color-muted-foreground)] truncate mt-0.5">{i.description}</span>}
                  </span>
                  {active && <Check className="w-4 h-4 shrink-0 text-[var(--color-brand)]" />}
                </button>
              </Popover.Close>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
