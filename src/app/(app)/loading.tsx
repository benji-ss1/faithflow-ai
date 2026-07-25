import Image from "next/image";

/**
 * Admin route-group loading state. Fires briefly during Next.js route
 * transitions and initial server data-fetch for any page inside the
 * (app) group. Matches the landing-page splash aesthetic: PresentFlow
 * mark centred on the deep-charcoal PresentFlow gradient background
 * with soft brand glows in the corners.
 *
 * Deliberately server-rendered + no client-side JS — this component
 * must be cheap to render because it appears during the critical
 * first-paint window. No `"use client"`.
 *
 * Kept OUTSIDE `.pf-admin-scope` on purpose: the scope's light-mode
 * tokens would fight the intentional dark hero aesthetic here.
 */
export default function AdminLoading() {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center overflow-hidden"
      style={{ background: "#0B0B0B" }}
      role="status"
      aria-label="Loading PresentFlow"
    >
      {/* Signature brand glows — purple top-left, orange bottom-right,
          matches the onboarding welcome hero + the marketing landing
          page splash. Subtle enough not to distract during a 100ms
          transition, present enough to feel branded. */}
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
          width={64}
          height={64}
          className="object-contain"
          style={{
            filter: "drop-shadow(0 12px 34px rgba(232,116,42,0.35))",
            animation: "pfPulse 3.4s ease-in-out infinite",
          }}
          priority
        />
        <div className="text-[22px] font-semibold tracking-[-0.01em]">
          <span style={{ color: "#F1EFE8" }}>Present</span>
          <span style={{ color: "#E8742A" }}>Flow</span>
        </div>
        <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: "#6B6A66" }}>
          Loading…
        </div>
      </div>
    </div>
  );
}
