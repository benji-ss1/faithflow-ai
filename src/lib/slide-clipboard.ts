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

/**
 * App-wide TEXT clipboard (C1). Separate from the slide clipboard: "Copy Text"
 * stores the slide's lyric text here so "Paste Text" can drop it onto ANOTHER
 * slide via the right-click menu — without touching that slide's design/layout.
 * In-memory per session; reactive via useTextClipboard().
 */
let textClip: string | null = null;
const textListeners = new Set<() => void>();

export function setTextClipboard(text: string): void {
  textClip = text;
  textListeners.forEach((l) => { try { l(); } catch { /* noop */ } });
}
export function getTextClipboard(): string | null { return textClip; }

export function useTextClipboard(): string | null {
  return useSyncExternalStore(
    (cb) => { textListeners.add(cb); return () => { textListeners.delete(cb); }; },
    () => textClip,
    () => textClip,
  );
}
