"use client";
/**
 * Feature flag for the ProPresenter 7 layer UI (clear rail beside the preview,
 * F-key clears, Media Bin clicks go behind the words). On by default.
 *
 * Kill switches: NEXT_PUBLIC_PP7_LAYERS=0 (everyone) or localStorage
 * `presentflow.pp7Layers.v1` = "0" (this machine). Read after mount so
 * server and first client render match.
 */
import { useEffect, useState } from "react";

export const PP7_LAYERS_STORAGE_KEY = "presentflow.pp7Layers.v1";

export function readPp7LayersFlag(): boolean {
  try {
    const local = window.localStorage.getItem(PP7_LAYERS_STORAGE_KEY);
    if (local === "1") return true;
    if (local === "0") return false;
  } catch { /* storage unavailable */ }
  // Default ON (2026-09-16, user-directed). NEXT_PUBLIC_PP7_LAYERS=0 turns it
  // off everywhere; localStorage "0" turns it off on one machine.
  return process.env.NEXT_PUBLIC_PP7_LAYERS !== "0";
}

export function usePp7Layers(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(readPp7LayersFlag());
    const onStorage = (e: StorageEvent) => { if (e.key === PP7_LAYERS_STORAGE_KEY) setOn(readPp7LayersFlag()); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return on;
}
