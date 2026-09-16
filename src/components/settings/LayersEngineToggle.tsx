"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setLayersEngineEnabled } from "@/lib/actions";

/**
 * Layers on/off for the whole church (2026-09-16). Layers powers the right-edge
 * T / camera / background strip, "Clear Lyrics" and the clear-everything X.
 * Admin-only on the server; non-admins get a clean error toast. Takes effect the
 * next time the operator screen is opened.
 */
export function LayersEngineToggle({ enabled: initial, globalOn }: { enabled: boolean; globalOn: boolean }) {
  const [enabled, setEnabled] = useState(initial);
  const [pending, start] = useTransition();
  const flip = () => {
    const next = !enabled;
    start(async () => {
      try {
        const res = await setLayersEngineEnabled(next);
        if (!res.ok) { toast.error(res.error ?? "Could not change Layers"); return; }
        setEnabled(next);
        toast.success(next ? "Layers turned on. Reopen the operator screen to see it." : "Layers turned off. Reopen the operator screen to apply.");
      } catch {
        toast.error("Could not change Layers. Only a church admin can change this.");
      }
    });
  };
  return (
    <div id="layers" className="mt-6 rounded-md border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">Layers</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Shows the strip on the right of the operator screen for hiding words, background, camera and logo one at a time.
            {!globalOn && " Not available on this version yet."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Layers"
          disabled={pending || !globalOn}
          onClick={flip}
          className={`h-9 px-3 shrink-0 rounded-md border text-xs font-semibold transition-all disabled:opacity-50 ${enabled ? "bg-foreground text-background border-foreground" : "border-border hover:bg-accent"}`}
        >
          {enabled ? "On" : "Off"}
        </button>
      </div>
    </div>
  );
}
