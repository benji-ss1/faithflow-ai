"use client";
/**
 * Layer Order V3: pause (never reset, never unmount) every <video> inside a
 * layer while it is fully covered or invisible, and resume exactly the videos
 * THIS hook paused once it is uncovered. `currentTime` is never touched, so an
 * uncover continues from where the clip was, and a video that was paused for
 * another reason (preview freeze, operator) is never force-played.
 * A video that mounts or autoplays while covered is caught by a capture-phase
 * `play` listener and paused immediately.
 */
import { useEffect, useRef, type RefObject } from "react";

const MARK = "v3CoverPaused";

export function usePauseCoveredVideos(ref: RefObject<HTMLElement | null>, paused: boolean): void {
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onPlay = (e: Event) => {
      const v = e.target as HTMLVideoElement | null;
      if (!pausedRef.current || !v || v.tagName !== "VIDEO") return;
      v.dataset[MARK] = "1";
      try { v.pause(); } catch { /* ignore */ }
    };
    el.addEventListener("play", onPlay, true);
    return () => el.removeEventListener("play", onPlay, true);
  }, [ref]);
  // Runs only when `paused` flips (not every render). Videos that mount or
  // autoplay while paused are caught by the capture `play` listener above, so no
  // per-render querySelectorAll / MutationObserver is needed.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    for (const v of Array.from(el.querySelectorAll("video"))) {
      if (paused) {
        if (!v.paused) { v.dataset[MARK] = "1"; try { v.pause(); } catch { /* ignore */ } }
      } else if (v.dataset[MARK] === "1") {
        delete v.dataset[MARK];
        try {
          const r = v.play();
          // AbortError (a pause/unmount raced the play) and NotAllowedError
          // (autoplay policy) are expected here — swallow quietly.
          if (r && typeof r.catch === "function") r.catch(() => { /* ignore */ });
        } catch { /* ignore */ }
      }
    }
  }, [ref, paused]);
}
