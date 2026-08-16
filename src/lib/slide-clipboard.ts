"use client";
/**
 * App-wide slide clipboard. A single copied slide, shared across surfaces (the
 * center slide grid AND the playlist item menu) so a slide copied in one place
 * can be pasted in another. In-memory (per session); useSlideClipboard() makes
 * consumers reactive to copy/clear.
 */
import { useSyncExternalStore } from "react";
import type { SlidePayload } from "./broadcast";

let clip: SlidePayload | null = null;
const listeners = new Set<() => void>();

export function setSlideClipboard(slide: SlidePayload): void {
  clip = slide;
  listeners.forEach((l) => { try { l(); } catch { /* noop */ } });
}
export function getSlideClipboard(): SlidePayload | null { return clip; }

export function useSlideClipboard(): SlidePayload | null {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => clip,
    () => clip,
  );
}
