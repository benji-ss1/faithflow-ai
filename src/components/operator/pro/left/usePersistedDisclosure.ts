"use client";
import { useEffect, useState } from "react";

/**
 * Collapsible-section state that defaults COLLAPSED and REMEMBERS the operator's
 * choice across reloads (localStorage). Used by the MEDIA and HARDWARE sidebar
 * sections so they stay tucked away until the operator opens them, and then stay
 * exactly how they left them. SSR-safe: renders the default on the server, reads
 * the stored value on mount.
 */
export function usePersistedDisclosure(
  key: string,
  defaultOpen = false,
): [boolean, () => void] {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(key);
      if (v === "1" || v === "0") setOpen(v === "1");
    } catch {
      /* ignore */
    }
  }, [key]);
  const toggle = () =>
    setOpen((prev) => {
      const nextOpen = !prev;
      try {
        window.localStorage.setItem(key, nextOpen ? "1" : "0");
      } catch {
        /* ignore */
      }
      return nextOpen;
    });
  return [open, toggle];
}
