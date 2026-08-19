"use client";
import { useState, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Bell, Sparkles } from "lucide-react";
import { CHANGELOG, type Highlight } from "@/lib/changelog";
import { cn } from "@/lib/utils";

export type Activity = { icon: ReactNode; title: string; desc: string; time: string };

/**
 * ActivitiesCard — a compact notifications/updates card (adapted from the
 * requested reference to this app's tokens): a header (icon + title + subtitle)
 * over a list of activity rows. Presentational + reusable.
 */
export function ActivitiesCard({
  headerIcon, title, subtitle, activities,
}: {
  headerIcon: ReactNode;
  title: string;
  subtitle: string;
  activities: Activity[];
}) {
  return (
    <div className="w-full">
      <div className="flex items-center gap-3 px-3.5 pt-3.5 pb-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--color-elevated)] text-[var(--color-muted-foreground)]">{headerIcon}</span>
        <span className="min-w-0">
          <span className="block text-[15px] font-semibold text-[var(--color-foreground)] leading-tight">{title}</span>
          <span className="block text-[12px] text-[var(--color-muted-foreground)] leading-tight mt-0.5">{subtitle}</span>
        </span>
      </div>
      <div className="max-h-[340px] overflow-y-auto px-1.5 pb-1.5">
        {activities.map((a, i) => (
          <div key={i} className={cn("flex items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-white/[0.04] transition-colors", i > 0 && "border-t border-[var(--color-border)]/60")}>
            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: "color-mix(in oklab, var(--color-brand) 14%, transparent)", color: "var(--color-brand)" }}>{a.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="text-[13px] font-semibold text-[var(--color-foreground)] leading-snug">{a.title}</span>
                <span className="ml-auto shrink-0 text-[10px] font-mono uppercase tracking-wide text-[var(--color-muted-foreground)]">{a.time}</span>
              </span>
              <span className="block text-[12px] text-[var(--color-muted-foreground)] leading-snug mt-0.5">{a.desc}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * FeaturesBell — a toolbar bell that opens the ActivitiesCard populated from the
 * changelog, so operators can revisit "what's new" any time after dismissing the
 * pop-up modal. Shows a dot until opened once per session.
 */
export function FeaturesBell() {
  const [seen, setSeen] = useState(false);

  const activities: Activity[] = CHANGELOG.slice(0, 8).map((e) => {
    const first: Highlight | undefined = e.highlights[0];
    const desc = typeof first === "string" ? first : (first?.text ?? "");
    return {
      icon: <Sparkles className="h-4 w-4" />,
      title: e.headline ?? `v${e.version}`,
      desc,
      time: e.date,
    };
  });

  return (
    <Popover.Root onOpenChange={(o) => { if (o) setSeen(true); }}>
      <Popover.Trigger asChild>
        <button
          type="button"
          title="What's new — recent features & updates"
          aria-label="Recent features and updates"
          className="relative grid h-8 w-8 place-items-center rounded-md text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-white/5 transition-colors"
        >
          <Bell className="h-4 w-4" />
          {!seen && <span aria-hidden className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full" style={{ background: "var(--color-brand)" }} />}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-[60] w-[340px] rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] shadow-2xl animate-in fade-in slide-in-from-top-1 duration-150"
          style={{ boxShadow: "0 24px 60px rgba(0,0,0,0.6)" }}
        >
          <ActivitiesCard
            headerIcon={<Bell className="h-5 w-5" />}
            title="What's new"
            subtitle="Recent features & updates"
            activities={activities}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
