"use client";
import { useCallback, useEffect, useState } from "react";
import type { Tier } from "@/lib/tier";

// SWR-lite: cache the fetch result in-memory for 60s so each mounted gated
// component doesn't refetch. First mount hits the network; subsequent
// mounts within the TTL read from cache. Focus / visibility / cross-tab
// storage events force a refetch so a mid-service upgrade in another
// window doesn't leave stale "free" state.

const TTL_MS = 60_000;
const STORAGE_INVALIDATE_KEY = "presentflow.tier.invalidate";
const CROSS_COMPONENT_EVENT = "presentflow:tier-updated";

type Cached = { tier: Tier; at: number };

let cache: Cached | null = null;
let inflight: Promise<Tier | null> | null = null;

function isFresh(): boolean {
  return !!cache && Date.now() - cache.at < TTL_MS;
}

async function fetchTier(force = false): Promise<Tier | null> {
  if (!force && isFresh()) return cache!.tier;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/tier", { cache: "no-store", credentials: "include" });
      if (res.status === 503) {
        // Fail-closed on server unavailability: preserve last-known-good tier.
        // If we've never had one, return null so the UI stays in "unknown"
        // and doesn't nag with upgrade prompts.
        return cache ? cache.tier : null;
      }
      if (!res.ok) {
        return cache ? cache.tier : null;
      }
      const json = (await res.json()) as { tier?: Tier | null };
      if (json.tier == null) {
        return cache ? cache.tier : null;
      }
      cache = { tier: json.tier, at: Date.now() };
      return cache.tier;
    } catch {
      return cache ? cache.tier : null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function notifyMounted() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CROSS_COMPONENT_EVENT));
  }
}

/** Client-side tier hook. Returns null during first load or on unavailable + no cache. */
export function useTier(): { tier: Tier | null; isMax: boolean; refresh: () => Promise<void> } {
  const [tier, setTier] = useState<Tier | null>(cache?.tier ?? null);

  const load = useCallback(async (force = false) => {
    const t = await fetchTier(force);
    setTier(t);
  }, []);

  const refresh = useCallback(async () => {
    await load(true);
    notifyMounted();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void fetchTier().then((t) => {
      if (!cancelled) setTier(t);
    });

    const onFocus = () => { void load(true); };
    const onVisibility = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        void load(true);
      }
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_INVALIDATE_KEY) {
        cache = null;
        void load(true);
      }
    };
    const onCrossComponent = () => {
      setTier(cache?.tier ?? null);
    };

    if (typeof window !== "undefined") {
      window.addEventListener("focus", onFocus);
      window.addEventListener("storage", onStorage);
      window.addEventListener(CROSS_COMPONENT_EVENT, onCrossComponent);
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }
    return () => {
      cancelled = true;
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", onFocus);
        window.removeEventListener("storage", onStorage);
        window.removeEventListener(CROSS_COMPONENT_EVENT, onCrossComponent);
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [load]);

  return { tier, isMax: tier === "max", refresh };
}

/** Testing / logout helper — clear the in-memory cache. */
export function _resetTierCache() {
  cache = null;
  inflight = null;
  notifyMounted();
}

/**
 * Cross-tab tier invalidation. Call after Stripe checkout success redirect
 * so any other open tab refetches its tier immediately.
 */
export function invalidateTierAcrossTabs() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_INVALIDATE_KEY, String(Date.now()));
    window.localStorage.removeItem(STORAGE_INVALIDATE_KEY);
  } catch {
    /* noop */
  }
  cache = null;
  notifyMounted();
}
