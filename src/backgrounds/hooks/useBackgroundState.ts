"use client";
import { useCallback, useEffect, useState } from "react";
import { BACKGROUND_CHANGED_EVENT, readActiveBackground, setActiveBackgroundId } from "../store/backgroundStore";
import type { PFBackground } from "../models/BackgroundTypes";
import { NONE_BACKGROUND } from "../presets/defaultTemplates";

/**
 * Active-background state, synced across the app via the background-changed
 * event. For a custom UPLOAD (image/video) it re-mints a fresh presigned URL
 * from the stored media key on mount / on change, so the projector never loads a
 * stale (expired) URL across sessions — the presign only lives ~6h.
 */
export function useBackgroundState(): { active: PFBackground; setActive: (id: string) => void } {
  const [active, setActiveState] = useState<PFBackground>(NONE_BACKGROUND);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      const bg = readActiveBackground();
      setActiveState(bg);
      if (!bg.isBuiltIn && bg.mediaKey && (bg.type === "image" || bg.type === "video")) {
        fetch("/api/media/url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: bg.mediaKey }),
        })
          .then((r) => r.json())
          .then((d: { url?: string }) => {
            if (!alive || !d.url) return;
            setActiveState((prev) =>
              prev.id === bg.id
                ? { ...prev, ...(bg.type === "image" ? { imageUrl: d.url } : { videoUrl: d.url }) }
                : prev,
            );
          })
          .catch(() => { /* keep the stored URL; BackgroundLayer fails safe */ });
      }
    };
    refresh();
    window.addEventListener(BACKGROUND_CHANGED_EVENT, refresh);
    return () => { alive = false; window.removeEventListener(BACKGROUND_CHANGED_EVENT, refresh); };
  }, []);

  const setActive = useCallback((id: string) => setActiveBackgroundId(id), []);
  return { active, setActive };
}
