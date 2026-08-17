"use client";
/**
 * Unified connection / service-health store — the single source of truth for
 * "what's degraded right now" that drives graceful degradation across the
 * operator console.
 *
 * Before this, three components each wired their own `navigator.onLine`
 * listener and there was no notion of PER-SERVICE health (Deepgram up but
 * Supabase down, or vice-versa). This store consolidates three independent
 * signals into one derived `mode` so the UI (and, later, the offline data
 * layer) can react to each dependency failing on its own:
 *
 *   1. network  — is there ANY internet? (navigator.onLine + online/offline events)
 *   2. ai       — the audio→Deepgram pipeline, fed in from useAudioStream
 *   3. data     — Supabase/Postgres reachability, from a light background poll
 *
 * Derived mode (most-severe first):
 *   OFFLINE       — no internet. Everything local; AI listening paused.
 *   DATA_DEGRADED — internet OK but Supabase unreachable. Serve local Bible,
 *                   queue writes.
 *   AI_DEGRADED   — internet OK but the AI pipeline is down. MANUAL MODE:
 *                   the operator drives by hand; console fully usable.
 *   FULLY_ONLINE  — everything healthy.
 *
 * A transient AI reconnect (backoff in-flight) is NOT a mode switch — it stays
 * FULLY_ONLINE so a 2s socket blip doesn't flash a scary banner. Only a
 * give-up (`reconnectFailed`) demotes to AI_DEGRADED.
 *
 * In-memory, per session; consumers subscribe via useConnectionHealth().
 */
import { useSyncExternalStore } from "react";

export type NetworkState = "online" | "offline";
export type AiHealth = "live" | "reconnecting" | "down" | "idle";
export type DataHealth = "ok" | "degraded" | "unknown";
export type ServiceMode = "FULLY_ONLINE" | "AI_DEGRADED" | "DATA_DEGRADED" | "OFFLINE";

export type ConnectionHealth = {
  network: NetworkState;
  ai: AiHealth;
  data: DataHealth;
  mode: ServiceMode;
};

const listeners = new Set<() => void>();
let network: NetworkState = "online";
let ai: AiHealth = "idle";
let data: DataHealth = "unknown";

// Cached snapshot so useSyncExternalStore's getSnapshot is referentially
// stable between changes (required — returning a fresh object every call
// makes React loop).
let snapshot: ConnectionHealth = compute();

function deriveMode(): ServiceMode {
  if (network === "offline") return "OFFLINE";
  if (data === "degraded") return "DATA_DEGRADED";
  if (ai === "down") return "AI_DEGRADED";
  return "FULLY_ONLINE";
}

function compute(): ConnectionHealth {
  return { network, ai, data, mode: deriveMode() };
}

function emit(): void {
  const next = compute();
  // Only churn subscribers when something actually changed.
  if (
    next.network === snapshot.network &&
    next.ai === snapshot.ai &&
    next.data === snapshot.data &&
    next.mode === snapshot.mode
  ) {
    return;
  }
  snapshot = next;
  listeners.forEach((l) => { try { l(); } catch { /* noop */ } });
}

// ── network tracking (auto-attached once, client-only) ──────────────────────
if (typeof window !== "undefined") {
  network = window.navigator.onLine ? "online" : "offline";
  snapshot = compute();
  window.addEventListener("online", () => {
    network = "online";
    emit();
    // Re-confirm data health immediately on reconnect instead of waiting up to
    // POLL_MS — clears a lingering DATA_DEGRADED as soon as the link is back.
    consecutiveDataFails = 0;
    if (pollTimer) void pollOnce();
  });
  window.addEventListener("offline", () => { network = "offline"; emit(); });
}

/** Feed the AI pipeline health in from useAudioStream's state. */
export function setAiHealth(next: AiHealth): void {
  if (ai === next) return;
  ai = next;
  emit();
}

/** Feed Supabase/data-layer reachability (from the background poller). */
export function setDataHealth(next: DataHealth): void {
  if (data === next) return;
  data = next;
  emit();
}

export function getConnectionHealth(): ConnectionHealth {
  return snapshot;
}

// Stable server/hydration snapshot. getServerSnapshot must equal the SSR value
// and must NOT reflect the client-only `navigator.onLine` read at import time —
// otherwise a machine that's offline at first paint would hydrate OFFLINE
// against a server-rendered FULLY_ONLINE and throw a hydration mismatch. The
// real client state takes over on the first post-hydration emit.
const SERVER_SNAPSHOT: ConnectionHealth = Object.freeze({
  network: "online", ai: "idle", data: "unknown", mode: "FULLY_ONLINE",
});

export function useConnectionHealth(): ConnectionHealth {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => snapshot,
    () => SERVER_SNAPSHOT,
  );
}

// ── background data-health poller ───────────────────────────────────────────
// Pings the REAL db health check (SELECT 1) on an interval while online, so a
// Supabase outage surfaces as DATA_DEGRADED within one poll instead of only
// when the operator happens to trigger a query. Deepgram/AI health is NOT
// polled here — the health endpoint is presence-only and unreliable; AI state
// comes from the live WebSocket via setAiHealth() instead.
let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollRefs = 0;
const POLL_MS = 30_000;
// Require TWO consecutive failures before alarming the operator mid-service — a
// single slow/aborted poll during a brief blip must not flash DATA_DEGRADED.
const DATA_FAIL_THRESHOLD = 2;
let consecutiveDataFails = 0;

async function pollOnce(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!window.navigator.onLine) return; // offline dominates; skip the fetch
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    const res = await fetch("/api/health/db", { signal: ctl.signal, cache: "no-store" });
    clearTimeout(t);
    // 401/403 = the operator's session expired; 429 = the shared /api/health/*
    // rate-limit budget (10/60s across all health routes) was hit. NEITHER is a
    // Supabase outage — don't mislabel an auth/ratelimit response as
    // data-degraded; leave the prior state intact. Only a 5xx/network failure
    // counts toward the failure threshold.
    if (res.status === 401 || res.status === 403 || res.status === 429) return;
    if (res.ok) {
      consecutiveDataFails = 0;
      setDataHealth("ok");
    } else {
      noteDataFailure();
    }
  } catch {
    // Network error / timeout. If we're actually offline, OFFLINE already
    // dominates the derived mode; otherwise count it toward the threshold.
    if (window.navigator.onLine) noteDataFailure();
  }
}

function noteDataFailure(): void {
  consecutiveDataFails++;
  if (consecutiveDataFails >= DATA_FAIL_THRESHOLD) setDataHealth("degraded");
}

/**
 * Start the background data-health poll. Ref-counted so multiple mounts share
 * one timer; returns a stop() that decrements and clears when the last
 * consumer unmounts. Call from the operator console.
 */
export function startDataHealthPolling(): () => void {
  pollRefs++;
  if (!pollTimer) {
    void pollOnce();
    pollTimer = setInterval(() => { void pollOnce(); }, POLL_MS);
    pollTimer.unref?.();
  }
  return () => {
    pollRefs = Math.max(0, pollRefs - 1);
    if (pollRefs === 0 && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };
}
