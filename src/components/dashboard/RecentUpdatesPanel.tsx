"use client";

import { useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { DashboardCard } from "@/components/dashboard/DashboardCard";
import { CHANGELOG } from "@/lib/changelog";

const RECENT_DAYS = 7;

function daysAgo(dateIso: string): number {
  const ms = Date.now() - new Date(dateIso + "T00:00:00Z").getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

/**
 * Replaces the old dashboard hero (Welcome card + Today's Service card) —
 * this is intentionally small and quiet: recent releases surface briefly,
 * then this whole panel fades to a one-line "no recent updates" state
 * rather than permanently occupying the top of the dashboard. Full history
 * stays available on demand via the expand toggle ("like a form you can
 * open up"), not as a separate page.
 */
export function RecentUpdatesPanel() {
  const [open, setOpen] = useState(false);
  const recent = CHANGELOG.filter((entry) => daysAgo(entry.date) <= RECENT_DAYS);
  const hasRecent = recent.length > 0;
  const latest = CHANGELOG[0];

  return (
    <DashboardCard
      title="Recent updates"
      eyebrow="What's new"
      tone="muted"
      className={cn(!hasRecent && !open && "py-3")}
    >
      {!hasRecent && !open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-between text-left text-sm text-muted-foreground transition hover:text-foreground"
        >
          <span>No recent updates — nothing new in the last {RECENT_DAYS} days.</span>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-foreground/80">
            View history
            <ChevronDown className="h-3.5 w-3.5" />
          </span>
        </button>
      ) : (
        <div className="space-y-3">
          {!open ? (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="flex w-full items-center gap-3 text-left"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
                <Sparkles className="h-4 w-4 text-[var(--color-primary)]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{latest.headline}</span>
                <span className="block text-xs text-muted-foreground">v{latest.version} · {latest.date}</span>
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex w-full items-center justify-between text-left text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Full history
                <ChevronDown className="h-3.5 w-3.5 rotate-180" />
              </button>
              <div className="max-h-64 space-y-4 overflow-y-auto border-l border-white/8 pl-3">
                {CHANGELOG.map((entry) => (
                  <div key={entry.version}>
                    <div className="text-sm font-medium text-foreground">{entry.headline}</div>
                    <div className="mb-1.5 text-xs text-muted-foreground">v{entry.version} · {entry.date}</div>
                    <ul className="space-y-1 text-xs leading-5 text-muted-foreground">
                      {entry.highlights.map((h, i) => (
                        <li key={i}>{h}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </DashboardCard>
  );
}
