"use client";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

/**
 * New-deploy detector. Polls /api/build-id; when the deployed build changes from
 * the one this tab loaded, it shows a ONE-CLICK "reload" toast so the operator
 * picks up the new build (the #1 cause of "I don't see the new feature" is a
 * stale cached bundle in the desktop shell).
 *
 * Deliberately NEVER auto-reloads — a prior auto-navigate service worker caused
 * an audio-killing reload loop. The operator taps to reload when it's safe (not
 * mid-verse). Fires the toast at most once per new build.
 */
export function UpdatePrompt() {
  const baselineRef = useRef<string | null>(null);
  const promptedForRef = useRef<string | null>(null);

  useEffect(() => {
    let stopped = false;

    const check = async () => {
      try {
        const res = await fetch("/api/build-id", { cache: "no-store" });
        if (!res.ok) return;
        const { id } = (await res.json()) as { id?: string };
        if (typeof id !== "string" || !id || id === "dev") return;
        if (baselineRef.current === null) {
          baselineRef.current = id; // first successful read = the build we're on
          return;
        }
        if (id !== baselineRef.current && promptedForRef.current !== id) {
          promptedForRef.current = id;
          toast("A new version of PresentFlow is available", {
            description: "Reload to get the latest fixes. Do it between slides — it takes a second.",
            duration: Infinity,
            action: {
              label: "Reload now",
              onClick: () => { try { window.location.reload(); } catch { /* noop */ } },
            },
          });
        }
      } catch { /* offline / transient — try again next tick */ }
    };

    void check();
    // Poll every 3 min, and whenever the window regains focus (operator came back).
    const iv = setInterval(() => { if (!stopped) void check(); }, 180_000);
    const onFocus = () => { if (!stopped) void check(); };
    window.addEventListener("focus", onFocus);
    return () => { stopped = true; clearInterval(iv); window.removeEventListener("focus", onFocus); };
  }, []);

  return null;
}
