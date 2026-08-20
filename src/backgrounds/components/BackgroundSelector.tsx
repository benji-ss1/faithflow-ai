"use client";
import { Check } from "lucide-react";
import { useBackgroundState } from "../hooks/useBackgroundState";
import { listBackgrounds } from "../store/backgroundStore";

/**
 * Backgrounds section — a NEW section that plugs into the existing Themes area
 * (it does NOT modify the theme system). Pick a background template; it applies
 * to the live projector instantly (behind the text). "None" = the current plain
 * theme background. Phase 6 adds per-template settings + image/video uploads;
 * this is the Phase 1–2 selector so backgrounds are verifiable on the projector.
 */
export function BackgroundSelector() {
  const { active, setActive } = useBackgroundState();
  const items = listBackgrounds();

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-muted-foreground)]">
        Backgrounds
      </div>
      <div className="grid grid-cols-3 gap-2">
        {items.map((bg) => {
          const isActive = active.id === bg.id;
          const swatch =
            bg.type === "none"
              ? "repeating-conic-gradient(var(--color-elevated) 0% 25%, transparent 0% 50%) 0 / 14px 14px"
              : `linear-gradient(135deg, ${bg.shaderPrimaryColor || "#0A0A0E"}, ${bg.shaderSecondaryColor || "#0F0F14"})`;
          return (
            <button
              key={bg.id}
              onClick={() => setActive(bg.id)}
              className="relative rounded-md overflow-hidden border transition-all text-left"
              style={{
                borderColor: isActive ? "var(--color-brand)" : "var(--color-border)",
                boxShadow: isActive ? "0 0 0 1px var(--color-brand)" : "none",
              }}
              title={bg.name}
            >
              <div className="aspect-video w-full" style={{ background: swatch }} />
              {isActive && (
                <span
                  className="absolute top-1 right-1 w-4 h-4 rounded-full inline-flex items-center justify-center"
                  style={{ background: "var(--color-brand)", color: "var(--color-primary-foreground)" }}
                >
                  <Check className="w-2.5 h-2.5" />
                </span>
              )}
              <div className="px-1.5 py-1 text-[10px] font-semibold text-[var(--color-foreground)] truncate">
                {bg.name}
              </div>
            </button>
          );
        })}
      </div>
      <div className="text-[10px] leading-snug text-[var(--color-muted-foreground)]">
        Applies live to the projector behind the text — the animated ones now move on the projector output. Per-template settings and your own image/video uploads are coming next.
      </div>
    </div>
  );
}
