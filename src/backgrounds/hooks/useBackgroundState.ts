"use client";
import { useCallback, useEffect, useState } from "react";
import { BACKGROUND_CHANGED_EVENT, readActiveBackground, setActiveBackgroundId } from "../store/backgroundStore";
import type { PFBackground } from "../models/BackgroundTypes";
import { NONE_BACKGROUND } from "../presets/defaultTemplates";

/**
 * Active-background state, synced across the app via the background-changed
 * event (same-machine). The operator console reads `active` and publishes its
 * derived spec on OutputState; the selector reads it to show what's active.
 */
export function useBackgroundState(): { active: PFBackground; setActive: (id: string) => void } {
  const [active, setActiveState] = useState<PFBackground>(NONE_BACKGROUND);

  useEffect(() => {
    setActiveState(readActiveBackground());
    const onChange = () => setActiveState(readActiveBackground());
    window.addEventListener(BACKGROUND_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(BACKGROUND_CHANGED_EVENT, onChange);
  }, []);

  const setActive = useCallback((id: string) => setActiveBackgroundId(id), []);
  return { active, setActive };
}
