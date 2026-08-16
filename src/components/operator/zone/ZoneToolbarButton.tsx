"use client";
import { useEffect, useState } from "react";

/**
 * Floating access button for the Projection Zone Customizer. Lives on the
 * OPERATOR control screen only (never the projector output). Pulses gently for
 * the first few launches when no custom profile exists yet, to advertise the
 * feature (spec §3 first-time experience).
 */
const PULSE_KEY = "presentflow.projectionZones.pulseCount.v1";

export function ZoneToolbarButton({ onOpen, hasCustomProfile }: { onOpen: () => void; hasCustomProfile: boolean }) {
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (hasCustomProfile) return; // already set up → no attention pulse
    try {
      const n = Number(window.localStorage.getItem(PULSE_KEY) ?? "0");
      if (n < 3) {
        setPulse(true);
        window.localStorage.setItem(PULSE_KEY, String(n + 1));
      }
    } catch { /* noop */ }
  }, [hasCustomProfile]);

  return (
    <>
      <style>{`@keyframes pf-zone-pulse{0%,100%{box-shadow:0 0 0 0 rgba(255,122,44,0.0)}50%{box-shadow:0 0 0 6px rgba(255,122,44,0.35)}}`}</style>
      <button
        type="button"
        onClick={() => { setPulse(false); onOpen(); }}
        title="Projection Zone"
        aria-label="Projection Zone"
        className="w-9 h-9 rounded-full flex items-center justify-center transition-colors"
        style={{
          background: "rgba(15,15,17,0.85)",
          border: "1px solid rgba(255,122,44,0.55)",
          color: "#ff7a2c",
          animation: pulse ? "pf-zone-pulse 1.8s ease-in-out infinite" : undefined,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,122,44,0.20)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(15,15,17,0.85)"; }}
      >
        {/* resize / layout glyph */}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 3v18M3 9h18" opacity="0.5" />
        </svg>
      </button>
    </>
  );
}
