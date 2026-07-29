"use client";
import { useEffect } from "react";
import { getRealtimeClient } from "@/lib/realtime";

/**
 * First slice of the web ↔ desktop sync work (Bucket 4). Subscribes to
 * Supabase Postgres changes on the `themes` table, filtered to the current
 * user's church, and dispatches `presentflow:sync-state` custom events so
 * the SyncIndicator in the topbar reflects real activity.
 *
 * Failure mode: if Supabase Realtime env is missing OR replication isn't
 * enabled on the `themes` table, this is a no-op — the sync indicator
 * stays on its browser-online default (green) and nothing breaks.
 *
 * Themes was chosen as the first table because it's low-traffic (edits
 * are rare) and low-stakes (a missed event just delays a UI refresh).
 * Songs / service_plans / team_members follow the same pattern once
 * replication is enabled on each in the Supabase dashboard.
 */
export function RealtimeSyncBridge({ churchId }: { churchId: string }) {
  useEffect(() => {
    const client = getRealtimeClient();
    if (!client || !churchId) return;

    function dispatchState(state: "synced" | "syncing" | "offline", at?: number) {
      window.dispatchEvent(new CustomEvent("presentflow:sync-state", {
        detail: { state, at: at ?? Date.now() },
      }));
    }

    // Brief syncing pulse on subscribe so admins see the indicator flicker
    // once and know the wiring is alive.
    dispatchState("syncing");

    const channel = client
      .channel(`pf-themes-${churchId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "themes", filter: `church_id=eq.${churchId}` },
        () => dispatchState("synced"),
      )
      .subscribe((status) => {
        // status ∈ "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED"
        if (status === "SUBSCRIBED") dispatchState("synced");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") dispatchState("offline");
      });

    return () => {
      try { void client.removeChannel(channel); } catch { /* ignore teardown races */ }
    };
  }, [churchId]);

  return null;
}
