"use client";
import { useEffect, useState } from "react";
import type { Tier } from "@/lib/tier";

// SWR-lite: cache the fetch result in-memory for the lifetime of the tab so
// each mounted gated component doesn't refetch. First mount hits the network;
// subsequent mounts read from the cache.
let cache: Tier | null = null;
let inflight: Promise<Tier> | null = null;

async function fetchTier(): Promise<Tier> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/tier", { cache: "no-store", credentials: "include" });
      if (!res.ok) return "free" as Tier;
      const json = (await res.json()) as { tier?: Tier };
      const tier = (json.tier ?? "free") as Tier;
      cache = tier;
      return tier;
    } catch {
      return "free" as Tier;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Client-side tier hook. Returns null during first load. */
export function useTier(): { tier: Tier | null; isMax: boolean } {
  const [tier, setTier] = useState<Tier | null>(cache);
  useEffect(() => {
    let cancelled = false;
    void fetchTier().then((t) => {
      if (!cancelled) setTier(t);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return { tier, isMax: tier === "max" };
}

/** Testing / logout helper — clear the in-memory cache. */
export function _resetTierCache() {
  cache = null;
  inflight = null;
}
