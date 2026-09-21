"use client";
/**
 * TRANSPARENT SLIDE LAYER (owner directive 2026-09-20, ProPresenter model).
 *
 *   "Default slides should be on a transparent background… the slide itself should
 *    basically contain the lyrics, scripture or text, while the background is a
 *    separate layer underneath. Only when a background is added through Themes for the
 *    desired colour should there actually be a coloured background on the slide… If the
 *    background is cleared, the slide should return to being transparent and the image
 *    underneath should immediately become visible again."
 *
 * Today a slide with NO theme background still paints an opaque near-black fill
 * (`themeBackgroundStyle(appearance, "#0b0b0b")` and friends), so it COVERS whatever
 * media, camera or background template sits underneath. That is the "everything is one
 * flat object" problem: the words and their backing are the same surface.
 *
 * With this on, the slide paints a colour ONLY when one was actually chosen — a theme
 * background colour/gradient/image, or a per-slide colour/image. Otherwise it is
 * transparent and the layer underneath shows through.
 *
 * Nothing goes see-through on a real screen: the opaque black is still there, it just
 * lives on the SURFACE (PP7's "Screen Color", the bottom layer) rather than on the
 * slide — `/live` is `fixed inset-0 bg-black`, `/livestream` paints `#000` unless it is
 * in transparent keying mode, and the operator cards carry their own base.
 *
 * KILL SWITCH — instant rollback, no rebuild:
 *   - `NEXT_PUBLIC_TRANSPARENT_SLIDE=0`              → everyone (needs a deploy)
 *   - localStorage `presentflow.transparentSlide.v1` → "0" off / "1" on, this machine,
 *     live (a `storage` event reaches already-open output windows)
 * With it OFF the render is byte-identical to before (golden-locked).
 */
import { useEffect, useState } from "react";

export const TRANSPARENT_SLIDE_STORAGE_KEY = "presentflow.transparentSlide.v1";

export function readTransparentSlideFlag(): boolean {
  try {
    const local = window.localStorage.getItem(TRANSPARENT_SLIDE_STORAGE_KEY);
    if (local === "1") return true;
    if (local === "0") return false;
  } catch { /* storage unavailable */ }
  return process.env.NEXT_PUBLIC_TRANSPARENT_SLIDE !== "0";
}

/** Mount-read (never during SSR/first paint, so server and first client render match)
 *  + live to the kill switch on this machine. */
export function useTransparentSlide(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const read = () => setOn(readTransparentSlideFlag());
    read();
    const onStorage = (e: StorageEvent) => { if (e.key === TRANSPARENT_SLIDE_STORAGE_KEY) read(); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return on;
}
