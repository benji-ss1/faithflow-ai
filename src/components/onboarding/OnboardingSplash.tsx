"use client";
import Image from "next/image";

/**
 * Fires once on first entry to /onboarding. Deep-charcoal background with
 * soft brand glows and the pulsing PresentFlow mark, matching the
 * landing-page splash. The wizard sets a localStorage flag after the first
 * play so returning users don't see it again.
 *
 * Duration is controlled by the parent (OnboardingWizard) — it renders
 * this component instead of the wizard for the first ~2.6s of the fresh-
 * signup flow. Deliberately no auto-timer inside the splash itself so the
 * wizard is the single source of truth for onboarding state transitions.
 */
export function OnboardingSplash() {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center overflow-hidden"
      style={{ background: "#0B0B0B" }}
      role="status"
      aria-label="Welcome to PresentFlow"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 12% 18%, rgba(155,143,232,0.22), transparent 42%), radial-gradient(circle at 88% 82%, rgba(232,116,42,0.28), transparent 42%)",
        }}
      />
      <div className="relative flex flex-col items-center gap-5">
        <Image
          src="/brand/pf-logo-mark.png"
          alt=""
          width={72}
          height={72}
          className="object-contain"
          style={{
            filter: "drop-shadow(0 12px 34px rgba(232,116,42,0.4))",
            animation: "pfPulse 2.4s ease-in-out infinite",
          }}
          priority
        />
        <div className="text-[24px] font-semibold tracking-[-0.01em]">
          <span style={{ color: "#F1EFE8" }}>Present</span>
          <span style={{ color: "#E8742A" }}>Flow</span>
        </div>
        <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: "#6B6A66" }}>
          Getting things ready
        </div>
      </div>
    </div>
  );
}
