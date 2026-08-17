"use client";
/**
 * Graceful-degradation banner for the operator console — scoped to the ONE
 * dimension nothing else already surfaces: DATA_DEGRADED (Supabase reachable-
 * but-down while the internet is up → local Bible + queued writes).
 *
 * Deliberately does NOT handle the other modes to avoid duplicate strips:
 *   - AI_DEGRADED  → owned by <AICaptionsBanner> (it already renders on
 *                    audio.reconnectFailed AND carries the "Retry now" button;
 *                    a second strip here would paint over that recovery control).
 *   - OFFLINE      → owned by the app-wide <OfflineIndicator>.
 *   - FULLY_ONLINE → nothing.
 *
 * Rendered at the BOTTOM, `pointer-events-none`, mirroring <OfflineIndicator>,
 * so it never overlays or intercepts clicks on the TopBar / Msg indicator.
 * (OFFLINE and DATA_DEGRADED are mutually exclusive by mode, so it can't
 * collide with the bottom-left OfflineIndicator.)
 */
import { useConnectionHealth } from "@/lib/connection/connectionHealth";

export function ServiceModeBanner() {
  const { mode } = useConnectionHealth();
  if (mode !== "DATA_DEGRADED") return null;

  const accent = "#e5484d"; // muted red — something upstream is unreachable
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-0 left-0 right-0 z-[9998] pointer-events-none flex items-center justify-center gap-2 px-3 py-1.5 text-[12px] font-medium"
      style={{ background: "rgba(15,15,17,0.92)", borderTop: `1px solid ${accent}` }}
    >
      <span
        aria-hidden
        className="inline-block w-2 h-2 rounded-full"
        style={{ background: accent, boxShadow: `0 0 0 3px ${accent}22` }}
      />
      <span style={{ color: "var(--color-foreground)" }}>
        Limited connectivity — showing your saved service. Changes will sync when the connection returns.
      </span>
    </div>
  );
}
