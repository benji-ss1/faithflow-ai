"use client";

import { useConnectionHealth } from "@/lib/connection/connectionHealth";

type AiResilienceBannerProps = {
  reconnecting: boolean;
};

/**
 * One small operator-facing explanation of the states that matter in a live
 * service. It never blocks the console: Preview, Send Live and every manual
 * control remain usable when AI or the internet is unavailable.
 *
 * "AI live" stays in the existing top-bar pill. This strip only appears when
 * a human needs to know that they should keep presenting manually.
 */
export function AiResilienceBanner({
  reconnecting,
}: AiResilienceBannerProps) {
  const { network } = useConnectionHealth();

  // Offline is owned by <OfflineIndicator>; a terminal outage is owned by
  // <AICaptionsBanner>. This component owns the short in-between state only,
  // preventing overlapping warnings in the operator workspace.
  if (network === "offline" || !reconnecting) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed top-[52px] left-1/2 z-[9998] flex -translate-x-1/2 items-center gap-2 rounded-md border border-[var(--color-warning)]/45 bg-[var(--color-elevated)] px-3 py-1.5 text-[11px] text-[var(--color-foreground)] shadow-[var(--edge-top),var(--shadow-md)]"
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--color-warning)] shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-warning)_20%,transparent)]" />
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-warning)]">AI reconnecting</span>
      <span className="text-[var(--color-muted-foreground)]">Manual controls remain ready.</span>
    </div>
  );
}
