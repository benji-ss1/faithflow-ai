"use client";
import { useEffect, useRef, useState } from "react";
import {
  resolveEndAction, resolveTrim, resolveRate, resolveVolume,
  pastOut, beforeIn, needsSupervision, type VideoPlaybackSpec,
} from "@/lib/video-playback";
import { reportMediaFailure } from "@/lib/media-failure";

/**
 * A slide video with ProPresenter's controls: trim, end-of-clip behaviour,
 * playback rate and volume. The decisions are all in `lib/video-playback.ts`;
 * this only applies them to the element.
 *
 * CHEAP BY DEFAULT: a clip with no trim and a plain loop/freeze is handed
 * entirely to the browser via the `loop` attribute, exactly as before — no
 * listeners, no seeking, no per-frame work. `needsSupervision()` decides, so the
 * common case costs nothing and cannot regress.
 */
export function SlideVideo({
  spec, url, fit, opacity, frozen, className, style,
}: {
  spec: VideoPlaybackSpec;
  url: string;
  fit?: "contain" | "cover" | "fill";
  opacity?: number;
  /** Thumbnail/preview surfaces hold the first frame instead of playing. */
  frozen?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [cleared, setCleared] = useState(false);
  const endAction = resolveEndAction(spec);
  const supervise = needsSupervision(spec);

  // Rate and volume are plain properties — set them whenever they change.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.playbackRate = resolveRate(spec);
    const { muted, volume } = resolveVolume(spec);
    el.muted = muted;
    el.volume = volume;
  }, [spec]);

  // A new clip must not inherit the previous one's "cleared" state.
  useEffect(() => { setCleared(false); }, [url]);

  useEffect(() => {
    const el = ref.current;
    if (!el || frozen || !supervise) return;

    const trimOf = () => resolveTrim(spec, el.duration);

    // Start at the in-point. `loadedmetadata` is when duration first exists.
    const onMeta = () => {
      const t = trimOf();
      if (t.start > 0) { try { el.currentTime = t.start; } catch { /* seek unavailable */ } }
    };

    const onTime = () => {
      const t = trimOf();
      if (t.end <= 0) return;
      // A seek (or a loop back to 0 on an untrimmed element) can land before
      // the in-point — pull it forward rather than playing trimmed-off footage.
      if (beforeIn(el.currentTime, t)) { try { el.currentTime = t.start; } catch { /* ignore */ } return; }
      if (!pastOut(el.currentTime, t)) return;
      switch (endAction) {
        case "loop":
          try { el.currentTime = t.start; void el.play(); } catch { /* ignore */ }
          return;
        case "freeze":
          // Hold the last frame: pause exactly at the out-point.
          try { el.pause(); el.currentTime = Math.max(0, t.end - 0.01); } catch { /* ignore */ }
          return;
        case "clear":
          try { el.pause(); } catch { /* ignore */ }
          setCleared(true);
          return;
      }
    };

    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("timeupdate", onTime);
    // Already loaded (cached clip): apply the in-point now.
    if (el.readyState >= 1) onMeta();
    return () => {
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("timeupdate", onTime);
    };
  }, [spec, endAction, supervise, frozen, url]);

  // "Clear" means the clip leaves the screen and reveals what is behind it.
  if (cleared) return null;

  return (
    <video
      ref={ref}
      src={url}
      autoPlay={!frozen}
      preload={frozen ? "metadata" : undefined}
      // When we supervise, the browser's own loop would fight our out-point,
      // so we drive looping ourselves.
      loop={supervise ? false : endAction === "loop"}
      muted={resolveVolume(spec).muted}
      playsInline
      className={className}
      style={{ width: "100%", height: "100%", objectFit: fit ?? "contain", display: "block", opacity: opacity ?? 1, ...style }}
      onError={(e) => {
        // The PROJECTOR stays clean — never paint an error on the audience
        // screen. The operator is told on their own surface instead.
        (e.currentTarget as HTMLVideoElement).style.visibility = "hidden";
        reportMediaFailure(url, "video");
      }}
    />
  );
}
