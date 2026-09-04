"use client";

/**
 * Networked projector sync via Supabase Realtime.
 *
 * Design notes:
 *  - BroadcastChannel (see broadcast.ts) is the low-latency same-machine path
 *    and MUST keep working. This module is strictly additive: cross-device fan-out.
 *  - Auth model: the pair code IS the shared secret. Channel name is
 *    `ff-out-<pairCode>`; anyone with the code (typed on the projector URL or
 *    scanned via QR) can subscribe. No user auth on the projector side.
 *  - Graceful degradation: if env is missing OR the client fails to init,
 *    getRealtimeClient() returns null and every wrapper method no-ops. The
 *    same-machine BroadcastChannel path continues to function normally.
 */

import { createClient, type SupabaseClient, type RealtimeChannel } from "@supabase/supabase-js";
import { isValidOutputStateExternal, type OutputState } from "./broadcast";

let _client: SupabaseClient | null = null;
let _warned = false;

export function getRealtimeClient(): SupabaseClient | null {
  if (_client) return _client;
  if (typeof window === "undefined") return null;
  // NOTE (2026-09-04): NEXT_PUBLIC_SUPABASE_URL/ANON_KEY are inlined at BUILD time.
  // They were added to Vercel Production but the cached build didn't re-inline them
  // (cross-device OBS overlay sync was silently disabled). Touching this module
  // busts its build-cache entry so the values inline. Cross-device overlay/projector
  // sync depends on these being present in the client bundle.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    if (!_warned) {
      _warned = true;
      // eslint-disable-next-line no-console
      console.warn(
        "[realtime] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing — cross-device sync disabled. Same-machine BroadcastChannel still works.",
      );
    }
    return null;
  }
  try {
    _client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 20 } },
    });
    return _client;
  } catch (e) {
    if (!_warned) {
      _warned = true;
      console.warn("[realtime] createClient failed:", e instanceof Error ? e.message : String(e));
    }
    return null;
  }
}

/**
 * Y8: Case-insensitive; caller-supplied pair codes normalized to upper.
 * Channel names are church-scoped so two churches picking the same 6-char
 * code (or an attacker fuzzing codes) never cross-talk. `churchId` is
 * lowercased and any non-hex characters stripped so the resulting name is
 * always a legal Supabase channel identifier.
 *
 * A missing/empty churchId falls back to the legacy `ff-out-<code>` form so
 * older pinned projectors keep working during the rollout — subscribers still
 * accept either form (see subscribeChannelNames).
 */
function normalizeChurchId(churchId: string | undefined | null): string {
  if (!churchId) return "";
  return churchId.trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
}

function chanName(pairCode: string, churchId?: string | null): string {
  const code = pairCode.trim().toUpperCase();
  const scope = normalizeChurchId(churchId);
  return scope ? `ff-out-${scope}-${code}` : `ff-out-${code}`;
}

export type OutputChannel = {
  /** Publish an OutputState frame to all subscribers on this channel. No-op if realtime unavailable. */
  publish: (state: OutputState) => Promise<void>;
  /**
   * Subscribe to OutputState frames. Returns unsubscribe. Handles reconnect w/ backoff.
   * On subscribe (or reconnect), immediately requests a snapshot from the publisher
   * so late/reconnecting projectors don't stare at black.
   */
  subscribe: (onState: (state: OutputState) => void) => void;
  /**
   * Publisher-side: register a callback that supplies the current state on demand.
   * When a new subscriber joins (or an existing one reconnects), the request/response
   * dance below replays the last frame so the projector catches up immediately.
   */
  onRequestSnapshot: (fn: () => OutputState | null) => void;
  /**
   * Subscribe to connection-status changes so the UI can show an honest
   * indicator ("connecting" → "connected" → "reconnecting"). "unavailable" means
   * cross-device realtime isn't configured at all (missing NEXT_PUBLIC_SUPABASE_*)
   * — same-machine sync still works but a 2nd-PC OBS overlay can never connect.
   */
  onStatus: (fn: (s: RealtimeConnStatus) => void) => void;
  /** Tear down the channel + any pending backoff timers. */
  close: () => void;
};

export type RealtimeConnStatus = "connecting" | "connected" | "reconnecting" | "unavailable";

/**
 * Open a bi-directional wrapper on channel `ff-out-<pairCode>`.
 * Publisher and subscribers share the same helper; each side uses only the
 * methods it needs.
 */
export function openOutputChannel(pairCode: string, churchId?: string | null): OutputChannel {
  const client = getRealtimeClient();
  const name = chanName(pairCode, churchId);

  let channel: RealtimeChannel | null = null;
  let currentHandler: ((state: OutputState) => void) | null = null;
  let snapshotProvider: (() => OutputState | null) | null = null;
  let closed = false;
  let backoffMs = 1000;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let subscribed = false;
  let statusHandler: ((s: RealtimeConnStatus) => void) | null = null;
  let lastStatus: RealtimeConnStatus | null = null;
  function reportStatus(s: RealtimeConnStatus) {
    lastStatus = s;
    try { statusHandler?.(s); } catch { /* ignore */ }
  }

  function attach() {
    if (!client || closed) return;
    reportStatus("connecting");
    try {
      channel = client.channel(name, { config: { broadcast: { self: false, ack: false } } });
      channel.on("broadcast", { event: "output" }, (payload) => {
        try {
          const state = (payload as { payload?: { state?: unknown } }).payload?.state;
          // Y9: never trust a wire payload — validate against the same
          // schema the BroadcastChannel receiver enforces.
          if (!isValidOutputStateExternal(state)) {
            console.warn("[realtime] rejected invalid OutputState payload");
            return;
          }
          if (currentHandler) currentHandler(state);
        } catch (e) {
          console.warn("[realtime] payload parse failed:", e instanceof Error ? e.message : String(e));
        }
      });
      // Snapshot request/response — late joiners ask, publisher replays the last frame.
      channel.on("broadcast", { event: "snapshot_request" }, async () => {
        if (!snapshotProvider) return;
        const state = snapshotProvider();
        if (state && channel && subscribed) {
          try { await channel.send({ type: "broadcast", event: "output", payload: { state } }); }
          catch { /* ignore */ }
        }
      });
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          subscribed = true;
          backoffMs = 1000;
          reportStatus("connected");
          // Ask any publisher on this channel for the current state so we don't
          // stare at black while waiting for the next operator interaction.
          if (currentHandler && channel) {
            channel.send({ type: "broadcast", event: "snapshot_request", payload: {} })
              .catch(() => { /* best-effort */ });
          }
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          subscribed = false;
          reportStatus("reconnecting");
          scheduleReconnect();
        }
      });
    } catch (e) {
      console.warn("[realtime] attach failed:", e instanceof Error ? e.message : String(e));
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (closed || !client) return;
    if (retryTimer) return; // one at a time
    const wait = Math.min(backoffMs, 30_000);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      backoffMs = Math.min(backoffMs * 2, 30_000);
      try { if (channel) client!.removeChannel(channel); } catch { /* ignore */ }
      channel = null;
      attach();
    }, wait);
  }

  return {
    async publish(state: OutputState) {
      if (!client || !channel || !subscribed) {
        // Not yet ready — the send will just be dropped. Callers still fire
        // BroadcastChannel same-machine so no user-facing regression.
        return;
      }
      try {
        await channel.send({ type: "broadcast", event: "output", payload: { state } });
      } catch (e) {
        console.warn("[realtime] publish failed:", e instanceof Error ? e.message : String(e));
      }
    },
    subscribe(onState) {
      currentHandler = onState;
      if (!client) { reportStatus("unavailable"); return; }
      if (!channel) attach();
    },
    onStatus(fn) {
      statusHandler = fn;
      // Replay the last known status immediately so a late listener isn't blank.
      if (!client) { fn("unavailable"); return; }
      if (lastStatus) fn(lastStatus);
    },
    onRequestSnapshot(fn) {
      snapshotProvider = fn;
      if (!channel) attach();
    },
    close() {
      closed = true;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      try { if (client && channel) client.removeChannel(channel); } catch { /* ignore */ }
      channel = null;
      currentHandler = null;
    },
  };
}

/** Validate pair-code format — 6 chars, alphanumeric excluding I/O/0/1. */
export function isValidPairCode(code: string): boolean {
  return /^[A-HJ-NP-Z2-9]{6}$/.test(code.trim().toUpperCase());
}
