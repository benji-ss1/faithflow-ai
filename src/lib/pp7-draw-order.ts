"use client";
/**
 * PP7 DRAW ORDER (spec item 1, Victor sign-off 2026-09-18).
 *
 * ProPresenter's output is eight FIXED layers. Top of the screen down:
 *
 *   Mask · Messages · Props · Announcements · Slide ·
 *   slide/presentation background colour · Media · Video Input · Screen Color
 *
 * Two of ours were in the wrong place (docs/PP7_LAYERS_SPEC.md §6):
 *   1. Props (our church-logo layer) drew BELOW Announcements.
 *   2. Media drew BELOW Video Input — the camera covered the media — and that
 *      was patched at RENDER time by a `mediaOverCamera` special case plus a
 *      three-way OR in the clear rail's media live-state. Two rules for one
 *      thing. This flag makes the ORDER itself right and deletes the patch.
 *
 * NOT MODELLED (no equivalent in PresentFlow today, deliberately out of scope):
 * Mask, Screen Color, and the slide/presentation BACKGROUND COLOUR row that PP7
 * 7.11 paints above Media — `ThemeAppearance.bgColor` is a per-slide/theme fill
 * rendered INSIDE SlideRenderer (the slide layer), not a separate output layer,
 * so there is no field to lift above Media without inventing one.
 *
 * KILL SWITCH — restores the previous rendering instantly, no rebuild:
 *   - `NEXT_PUBLIC_PP7_DRAW_ORDER=0`               → everyone (needs a deploy)
 *   - localStorage `presentflow.pp7DrawOrder.v1`   → "0" off / "1" on, this
 *     machine, live (a `storage` event reaches already-open output windows)
 *   - turning the whole PP7 layer UI off (NEXT_PUBLIC_PP7_LAYERS=0 /
 *     localStorage `presentflow.pp7Layers.v1`="0") also turns the order off.
 *
 * The flag-OFF plan is byte-locked against `test/fixtures/output-plan-main.golden.json`
 * (22,400 fixtures) by `test/pp7-draw-order.test.ts`.
 */
import { useEffect, useState } from "react";
import { readPp7LayersFlag, PP7_LAYERS_STORAGE_KEY } from "./pp7-layers-flag";

export const PP7_DRAW_ORDER_STORAGE_KEY = "presentflow.pp7DrawOrder.v1";

export function readPp7DrawOrderFlag(): boolean {
  // The PP7 layer stack is the parent feature — no rail, no PP7 order.
  if (!readPp7LayersFlag()) return false;
  try {
    const local = window.localStorage.getItem(PP7_DRAW_ORDER_STORAGE_KEY);
    if (local === "1") return true;
    if (local === "0") return false;
  } catch { /* storage unavailable */ }
  return process.env.NEXT_PUBLIC_PP7_DRAW_ORDER !== "0";
}

/**
 * Mount-read (never during SSR/first paint, so server and first client render
 * match) + live to both kill switches on this machine.
 */
export function usePp7DrawOrder(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const read = () => setOn(readPp7DrawOrderFlag());
    read();
    const onStorage = (e: StorageEvent) => {
      if (e.key === PP7_DRAW_ORDER_STORAGE_KEY || e.key === PP7_LAYERS_STORAGE_KEY) read();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return on;
}
