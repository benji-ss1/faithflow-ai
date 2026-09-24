"use client";
/**
 * LAYER ORDER V3 (composable layers, Addendum A of docs/COMPOSABLE_PLAN_2026-09-23.md).
 *
 * ProPresenter-style fixed, independent, persistent layers:
 *   media (z0) → theme background (z10) → slide content (z20) → overlays (z30+).
 * Media is OutputState.background (+ camera). The theme background is its own
 * layer with REAL CSS transparency (`layerOpacity`); it belongs to the
 * presentation, so it only shows while a slide is live. The slide paints only
 * its own explicit / non-default colour or bgImageUrl. Applying/clearing a
 * theme never touches media.
 *
 * DEFAULT OFF. Flag-off output is byte-identical (golden-locked).
 * KILL SWITCH / ENABLE:
 *   - localStorage `presentflow.layerOrderV3.v1` → "1" on / "0" off (this machine, live)
 *   - `NEXT_PUBLIC_LAYER_ORDER_V3=1` → everyone (needs a deploy)
 * The operator carries the decision on OutputState.layerOrderV3 so remote
 * receivers need no DB or localStorage. (A per-church column exists only as an
 * un-applied migration file: docs/migrations/2026-09-24-layer-order-v3.sql.)
 *
 * SINGLE SOURCE: `readLayerOrderV3Flag()` is the only reader. `useLayerOrderV3()`
 * subscribes to it (same-tab CustomEvent from `setLayerOrderV3Flag` + cross-tab
 * `storage`), so an operator click handler (which calls the reader) and the
 * OutputState the console emits (from the hook) can never disagree.
 */
import { useSyncExternalStore } from "react";

export const LAYER_ORDER_V3_STORAGE_KEY = "presentflow.layerOrderV3.v1";
/** Same-tab change notification (the `storage` event only fires in OTHER tabs). */
export const LAYER_ORDER_V3_EVENT = "presentflow:layer-order-v3-changed";

export function readLayerOrderV3Flag(): boolean {
  try {
    const local = typeof window !== "undefined" ? window.localStorage.getItem(LAYER_ORDER_V3_STORAGE_KEY) : null;
    if (local === "1") return true;
    if (local === "0") return false;
  } catch { /* storage unavailable */ }
  return process.env.NEXT_PUBLIC_LAYER_ORDER_V3 === "1";
}

/** Flip this machine's switch (null = follow the env default). Notifies every
 *  subscriber in this tab synchronously; other tabs hear `storage`. */
export function setLayerOrderV3Flag(on: boolean | null): void {
  try {
    if (on === null) window.localStorage.removeItem(LAYER_ORDER_V3_STORAGE_KEY);
    else window.localStorage.setItem(LAYER_ORDER_V3_STORAGE_KEY, on ? "1" : "0");
  } catch { /* storage unavailable */ }
  try { window.dispatchEvent(new CustomEvent(LAYER_ORDER_V3_EVENT)); } catch { /* no window */ }
}

function subscribe(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => { if (e.key === null || e.key === LAYER_ORDER_V3_STORAGE_KEY) cb(); };
  window.addEventListener("storage", onStorage);
  window.addEventListener(LAYER_ORDER_V3_EVENT, cb);
  return () => { window.removeEventListener("storage", onStorage); window.removeEventListener(LAYER_ORDER_V3_EVENT, cb); };
}
const serverSnapshot = () => false;

/** Live view of `readLayerOrderV3Flag()`. SSR / hydration read false (first
 *  paint matches the server), then the real value. */
export function useLayerOrderV3(): boolean {
  return useSyncExternalStore(subscribe, readLayerOrderV3Flag, serverSnapshot);
}
