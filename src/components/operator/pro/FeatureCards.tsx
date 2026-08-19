import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type FeatureItem = { icon: LucideIcon; title: string; desc: string };

/**
 * FeatureCards — icon + big title + muted description cards on a faint
 * graph-paper grid (adapted from the requested Faaast/Customization reference).
 * Dashed dividers join the cards into one block. Reusable — pass any items.
 */
export function FeatureCards({ items, className, columns = 2 }: {
  items: FeatureItem[];
  className?: string;
  columns?: 1 | 2 | 3;
}) {
  const cols = columns === 3 ? "sm:grid-cols-3" : columns === 2 ? "sm:grid-cols-2" : "grid-cols-1";
  return (
    <div className={cn("grid grid-cols-1 rounded-2xl overflow-hidden border border-dashed border-[var(--color-border)]", cols, className)}>
      {items.map((it, i) => {
        const Icon = it.icon;
        return (
          <div
            key={i}
            className="relative overflow-hidden p-6 sm:p-7 border-dashed border-[var(--color-border)] border-t first:border-t-0 sm:[&:nth-child(-n+3)]:border-t-0 sm:[&:not(:nth-child(3n+1))]:border-l"
            style={{ background: "var(--color-panel)" }}
          >
            <div aria-hidden className="pf-grid-pattern absolute inset-0 pointer-events-none" />
            <div className="relative">
              <span className="grid h-9 w-9 place-items-center rounded-lg" style={{ border: "1px solid var(--color-border)", background: "color-mix(in oklab, var(--color-brand) 8%, transparent)" }}>
                <Icon className="h-[18px] w-[18px] text-[var(--color-brand)]" strokeWidth={1.6} />
              </span>
              <h3 className="mt-5 text-[19px] font-semibold tracking-tight text-[var(--color-foreground)] font-display">{it.title}</h3>
              <p className="mt-1.5 max-w-[42ch] text-[13px] leading-relaxed text-[var(--color-muted-foreground)]">{it.desc}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
