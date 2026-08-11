"use client";
import { useEffect, useState } from "react";

/**
 * Subtle app-wide banner shown only when the browser reports offline, so an
 * operator knows the service is running from the local cache (and that live AI
 * listening is paused). Non-interactive; renders nothing when online.
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
      className="fixed bottom-3 left-3 z-[9999] flex items-center gap-2 rounded-md bg-amber-600/95 px-3 py-1.5 text-[12px] font-medium text-white shadow-lg pointer-events-none"
    >
      <span className="inline-block h-2 w-2 rounded-full bg-white/90" />
      Offline — presenting from your saved service. Live AI listening is paused.
    </div>
  );
}
