"use client";
import { useEffect, useState } from "react";

/**
 * App-wide local-mode indicator shown only when the browser reports offline.
 * It is deliberately compact and non-interactive: the normal PresentFlow
 * operator controls remain the place to keep presenting.
 */
export function OfflineIndicator() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  if (!offline) return null;
  return (
    <div
      role="status"
      className="pointer-events-none fixed bottom-3 left-3 z-[9999] flex max-w-[min(420px,calc(100vw-1.5rem))] items-center gap-2 rounded-md border border-[var(--color-warning)]/45 bg-[var(--color-elevated)] px-3 py-2 text-[12px] shadow-[var(--edge-top),var(--shadow-lg)]"
    >
      <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-warning)] shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-warning)_20%,transparent)]" />
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-warning)]">Offline local mode</span>
      <span className="text-[var(--color-muted-foreground)]">Saved service is ready. AI waits for internet.</span>
    </div>
  );
}
