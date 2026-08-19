import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Integration = {
  id: string;
  name: string;
  /** Small uppercase mono meta line (e.g. what it connects). */
  entities?: string;
  description: string;
  tags?: string[];
  triggers?: number;
  actions?: number;
  /** false → shown with a "Soon" badge and dimmed. */
  available?: boolean;
  icon: ReactNode;
};

/**
 * IntegrationsCard — a grid of integration cards (adapted from the requested
 * reference to this app's tokens): icon + name + entities + description + tags,
 * optional trigger/action counts, and an availability badge. Reusable.
 */
export function IntegrationsCard({ title, items, className }: {
  title?: string;
  items: Integration[];
  className?: string;
}) {
  return (
    <div className={className}>
      {title && <h3 className="mb-4 text-[15px] font-semibold text-[var(--color-foreground)]">{title}</h3>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <div
            key={it.id}
            className={cn(
              "flex flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4 transition-colors hover:border-[var(--color-brand)]/40",
              it.available === false && "opacity-70",
            )}
          >
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)]">{it.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[14px] font-semibold text-[var(--color-foreground)]">{it.name}</span>
                  {it.available === false && (
                    <span className="shrink-0 rounded px-1.5 py-px text-[9px] font-mono font-bold uppercase tracking-wide" style={{ background: "var(--color-elevated)", color: "var(--color-muted-foreground)", border: "1px solid var(--color-border)" }}>Soon</span>
                  )}
                </div>
                {it.entities && <div className="mt-0.5 truncate text-[10px] font-mono uppercase tracking-wide text-[var(--color-muted-foreground)]">{it.entities}</div>}
              </div>
            </div>
            <p className="mt-3 flex-1 text-[13px] leading-relaxed text-[var(--color-muted-foreground)]">{it.description}</p>
            {it.tags && it.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {it.tags.map((t) => (
                  <span key={t} className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: "color-mix(in oklab, var(--color-brand) 10%, transparent)", color: "var(--color-brand)", border: "1px solid color-mix(in oklab, var(--color-brand) 30%, transparent)" }}>{t}</span>
                ))}
              </div>
            )}
            {(it.triggers != null || it.actions != null) && (
              <div className="mt-3 flex items-center gap-4 border-t border-[var(--color-border)] pt-3 text-[11px] text-[var(--color-muted-foreground)]">
                {it.triggers != null && <span><b className="text-[var(--color-foreground)]">{it.triggers}</b> triggers</span>}
                {it.actions != null && <span><b className="text-[var(--color-foreground)]">{it.actions}</b> actions</span>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
