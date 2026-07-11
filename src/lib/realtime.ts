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
import type { OutputState } from "./broadcast";

let _client: SupabaseClient | null = null;
let _warned = false;

export function getRealtimeClient(): SupabaseClient | null {
  if (_client) return _client;
  if (typeof window === "undefined") return null;
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

/** Case-insensitive; caller-supplied pair codes are normalized to upper. */
function chanName(pairCode: string): string {
  return `ff-out-${pairCode.trim().toUpperCase()}`;
}

export type OutputChannel = {
  /** Publish an OutputState frame to all subscribers on this channel. No-op if realtime unavailable. */
  publish: (state: OutputState) => Promise<void>;
  /** Subscribe to OutputState frames. Returns unsubscribe. Handles reconnect w/ backoff. */
  subscribe: (onState: (state: OutputState) => void) => void;
  /** Tear down the channel + any pending backoff timers. */
  close: () => void;
};

/**
 * Open a bi-directional wrapper on channel `ff-out-<pairCode>`.
 * Publisher and subscribers share the same helper; each side uses only the
 * methods it needs.
 */
export function openOutputChannel(pairCode: string): OutputChannel {
  const client = getRealtimeClient();
  const name = chanName(pairCode);

  let channel: RealtimeChannel | null = null;
  let currentHandler: ((state: OutputState) => void) | null = null;
  let closed = false;
  let backoffMs = 1000;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let subscribed = false;

  function attach() {
    if (!client || closed) return;
    try {
      channel = client.channel(name, { config: { broadcast: { self: false, ack: false } } });
      channel.on("broadcast", { event: "output" }, (payload) => {
        try {
          const state = (payload as { payload?: { state?: OutputState } }).payload?.state;
          if (state && currentHandler) currentHandler(state);
        } catch (e) {
          console.warn("[realtime] payload parse failed:", e instanceof Error ? e.message : String(e));
        }
      });
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          subscribed = true;
          backoffMs = 1000; // reset
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          subscribed = false;
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
