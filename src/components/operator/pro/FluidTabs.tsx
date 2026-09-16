"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isWindowsUA } from "@/lib/platform";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type FluidTab = { id: string; label: string; icon: LucideIcon };

/**
 * FluidTabs — segmented pill nav with a single indicator that fluidly slides
 * and resizes between the active tab (adapted from the requested reference to
 * this app's stack: no framer-motion, just a measured indicator + CSS
 * transition). `activeId` may be a value that isn't in `tabs` (e.g. the
 * operator's "slides" mode) — the indicator simply hides. `action` is an
 * always-plain trailing button (e.g. Themes) that never takes the indicator.
 */
export function FluidTabs({
  tabs, activeId, onSelect, action,
}: {
  tabs: FluidTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  action?: { label: string; icon: LucideIcon; onClick: () => void };
}) {
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [ind, setInd] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const el = activeId ? tabRefs.current[activeId] : null;
    if (el) setInd({ left: el.offsetLeft, width: el.offsetWidth });
    else setInd(null);
  }, [activeId, tabs.length]);

  // Windows: tab labels hide/show across a width breakpoint on window resize
  // (globals/TopBar compaction), which changes tab widths without changing
  // activeId — re-measure so the indicator never covers neighbouring tabs.
  // Equality-guarded; not attached on macOS (no label breakpoint there).
  useEffect(() => {
    if (typeof ResizeObserver === "undefined" || !isWindowsUA()) return;
    const el = activeId ? tabRefs.current[activeId] : null;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setInd((prev) =>
        prev && prev.left === el.offsetLeft && prev.width === el.offsetWidth
          ? prev
          : { left: el.offsetLeft, width: el.offsetWidth });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [activeId, tabs.length]);

  return (
    <div className="relative flex items-center gap-0.5 p-0.5 rounded-full border border-[var(--color-border)] bg-[var(--color-panel)]">
      {/* Sliding indicator */}
      {ind && (
        <span
          aria-hidden
          className="absolute top-0.5 bottom-0.5 rounded-full pointer-events-none"
          style={{
            left: ind.left,
            width: ind.width,
            background: "var(--color-elevated)",
            boxShadow: "0 0 0 1px color-mix(in oklab, var(--color-brand) 55%, transparent), 0 1px 4px rgba(0,0,0,0.35)",
            transition: "left .32s cubic-bezier(.4,0,.2,1), width .32s cubic-bezier(.4,0,.2,1)",
          }}
        />
      )}
      {tabs.map((t) => {
        const active = t.id === activeId;
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            ref={(el) => { tabRefs.current[t.id] = el; }}
            type="button"
            onClick={() => onSelect(t.id)}
            aria-pressed={active}
            aria-label={t.label}
            className={cn(
              "relative z-10 flex items-center gap-1.5 h-[30px] px-3 rounded-full text-[12px] font-medium transition-colors",
              active ? "text-[var(--color-foreground)] font-semibold" : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
            )}
          >
            <Icon className="w-3.5 h-3.5 shrink-0" />
            <span className="[html[data-platform=win]_&]:max-[1180px]:hidden">{t.label}</span>
          </button>
        );
      })}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          aria-label={action.label}
          data-fluid-action={action.label}
          className="relative z-10 flex items-center gap-1.5 h-[30px] px-3 rounded-full text-[12px] font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
        >
          <action.icon className="w-3.5 h-3.5 shrink-0" />
          <span className="[html[data-platform=win]_&]:max-[1180px]:hidden">{action.label}</span>
        </button>
      )}
    </div>
  );
}
