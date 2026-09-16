"use client";
import { useEffect, useState } from "react";
import { shortcutLabel, isWindowsUA } from "@/lib/platform";

/** Shortcut label resolved AFTER mount: first render = Mac text (matches SSR), then platform-correct. */
export function useShortcutLabel(keys: Parameters<typeof shortcutLabel>[0]): string {
  const [label, setLabel] = useState(() => shortcutLabel(keys, "Mac"));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setLabel(shortcutLabel(keys)); }, []);
  return label;
}

/** true on Windows, resolved after mount (false during SSR/first render). */
export function useIsWindows(): boolean {
  const [win, setWin] = useState(false);
  useEffect(() => { setWin(isWindowsUA()); }, []);
  return win;
}
