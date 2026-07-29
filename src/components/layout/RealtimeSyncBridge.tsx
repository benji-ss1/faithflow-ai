"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getRealtimeClient } from "@/lib/realtime";

/**
 * Bucket 4/9: web ↔ desktop sync bridge. Subscribes to Supabase Postgres
 * changes on tenant-scoped tables and calls `router.refresh()` so any
 * open admin surface (sidebar, team page, service editor) picks up the
 * remote write within a Realtime hop instead of on next navigation.
 *
 * Coverage:
 *   - themes           (INSERT/UPDATE/DELETE)  — first slice, v0.1.87
 *   - songs            (INSERT/UPDATE/DELETE)  — library edits
 *   - service_plans    (INSERT/UPDATE/DELETE)  — plan CRUD from other device
 *   - service_items    (INSERT/UPDATE/DELETE)  — chatty; debounced 500ms
 *   - settings         (UPDATE)                — logo/branding → sidebar
 *   - users            (UPDATE, church-scoped) — role/name → Team page
 *
 * Rules honoured (see CLAUDE.md #8):
 *   - BroadcastChannel same-machine primary path is UNTOUCHED — this is
 *     additive fan-out only.
 *   - All filters are church-scoped via `church_id=eq.<churchId>`.
 *   - Graceful degradation: if env is missing OR replication isn't
 *     enabled on a table, this is a no-op. Sidebar sync indicator stays
 *     on browser-online default; nothing breaks.
 *   - router.refresh() is debounced (500ms) so a burst of service_items
 *     writes triggers a single refresh, not one per row.
 */
export function RealtimeSyncBridge({ churchId }: { churchId: string }) {
  const router = useRouter();

  useEffect(() => {
    const client = getRealtimeClient();
    if (!client || !churchId) return;

    function dispatchState(state: "synced" | "syncing" | "offline", at?: number) {
      window.dispatchEvent(new CustomEvent("presentflow:sync-state", {
        detail: { state, at: at ?? Date.now() },
      }));
    }

    // Debounced router.refresh — coalesces bursts (esp. service_items).
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    function scheduleRefresh() {
      dispatchState("syncing");
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        try { router.refresh(); } catch { /* ignore stale router */ }
        dispatchState("synced");
      }, 500);
    }

    // Brief syncing pulse on subscribe so admins see the indicator flicker
    // once and know the wiring is alive.
    dispatchState("syncing");

    const filter = `church_id=eq.${churchId}`;
    // service_items has NO church_id column — it's scoped via service_plan_id.
    // Rather than resolve the plan set on the client, we subscribe without a
    // filter and rely on the 500ms debounce + the fact that a stray cross-
    // church refresh only re-renders server components that ARE church-scoped
    // (via requireUser()), so it's a wasted RSC round-trip at worst, not a
    // data leak. If this proves too chatty in prod, drop the item-level sub
    // and lean on service_plans updates (parent bumps updated_at on child
    // writes via the server action).

    const channel = client
      .channel(`pf-sync-${churchId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "themes", filter }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "songs", filter }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "service_plans", filter }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "service_items" }, scheduleRefresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "settings", filter }, scheduleRefresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "users", filter }, scheduleRefresh)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") dispatchState("synced");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") dispatchState("offline");
      });

    return () => {
      if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
      try { void client.removeChannel(channel); } catch { /* ignore teardown races */ }
    };
  }, [churchId, router]);

  return null;
}
