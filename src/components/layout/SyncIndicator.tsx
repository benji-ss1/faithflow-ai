"use client";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Small green/amber/red dot + "Last synced" tooltip for the topbar.
 * Section 9 first slice — UI only for now. Real Realtime hooks land in a
 * later commit; today the state reads from a single custom event
 * `presentflow:sync-state` dispatched on `window`. That gives us the
 * canonical wiring surface without pulling in the Supabase Realtime
 * subsystem yet.
 *
 * Consumers can drive the indicator by dispatching:
 *   window.dispatchEvent(new CustomEvent("presentflow:sync-state", {
 *     detail: { state: "synced" | "syncing" | "offline", at?: number }
 *   }));
 *
 * When nothing has dispatched, it renders "Synced · just now" — a benign
 * default that matches the actual behavior of the app today (data reads
 * are RSC + revalidatePath, which are effectively real-time from the
 * user's perspective).
 */

type State = "synced" | "syncing" | "offline";

const STATE_META: Record<State, { color: string; label: string; ring: string }> = {
  synced:  { color: "var(--pf-admin-green)", label: "Synced",  ring: "rgba(61,154,80,0.35)" },
  syncing: { color: "var(--pf-admin-gold)",  label: "Syncing", ring: "rgba(239,159,39,0.35)" },
  offline: { color: "var(--pf-admin-red)",   label: "Offline", ring: "rgba(220,53,69,0.35)" },
};

function relative(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function SyncIndicator() {
  const [state, setState] = useState<State>("synced");
  const [at, setAt] = useState<number>(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    function onEvent(e: Event) {
      const detail = (e as CustomEvent<{ state?: State; at?: number }>).detail;
      if (detail?.state === "synced" || detail?.state === "syncing" || detail?.state === "offline") {
        setState(detail.state);
      }
      if (typeof detail?.at === "number") setAt(detail.at);
      else if (detail?.state === "synced") setAt(Date.now());
    }
    window.addEventListener("presentflow:sync-state", onEvent);

    // Also flip to "offline" when the browser reports itself offline. Cheap
    // signal; matches user's intuition ("wifi dropped").
    function onOnline() { setState("synced"); setAt(Date.now()); }
    function onOffline() { setState("offline"); }
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    if (typeof navigator !== "undefined" && navigator.onLine === false) setState("offline");

    // Tick every 30s to keep the "N min ago" text fresh.
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);

    return () => {
      window.removeEventListener("presentflow:sync-state", onEvent);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.clearInterval(tick);
    };
  }, []);

  const meta = STATE_META[state];
  const tooltip = state === "offline"
    ? "Offline — showing cached data. Changes will save when you reconnect."
    : state === "syncing"
      ? "Syncing…"
      : `Synced · ${relative(at)}`;
  // Use `now` in the render to force a re-render on tick without touching state's identity.
  void now;

  return (
    <div
      className="hidden items-center gap-1.5 rounded-md border border-[var(--pf-admin-border)] bg-[var(--pf-admin-bg-subtle)] px-2 py-1 text-[10px] font-medium lg:inline-flex"
      title={tooltip}
      role="status"
      aria-label={tooltip}
    >
      <span
        className={cn("relative inline-flex h-2 w-2 rounded-full", state === "syncing" && "animate-pulse")}
        style={{ background: meta.color, boxShadow: `0 0 0 3px ${meta.ring}` }}
      />
      <span className="text-[var(--pf-admin-text-secondary)]">{meta.label}</span>
    </div>
  );
}
