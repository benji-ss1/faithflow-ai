"use client";

import { useConnectionHealth } from "@/lib/connection/connectionHealth";

type AiResilienceBannerProps = {
  reconnecting: boolean;
  unavailable: boolean;
  onRetry: () => void;
};

/**
 * One small operator-facing explanation of the states that matter in a live
 * service. It never blocks the console: Preview, Send Live and every manual
 * control remain usable when AI or the internet is unavailable.
 *
 * "AI live" stays in the existing top-bar pill. This strip only appears when
 * a human needs to know that they should keep presenting manually.
 */
export function AiResilienceBanner({
  reconnecting,
  unavailable,
  onRetry,
}: AiResilienceBannerProps) {
  const { network } = useConnectionHealth();

  if (network === "offline") {
    return (
      <StatusStrip tone="amber">
        <strong>Offline local mode</strong>
        <span>Present from your saved service. AI will return when internet returns; use the normal manual controls now.</span>
      </StatusStrip>
    );
  }

  if (unavailable) {
    return (
      <StatusStrip tone="red">
        <strong>AI unavailable — manual mode active</strong>
        <span>Present normally with Preview and Send Live. Nothing will auto-send.</span>
        <button
          type="button"
          onClick={onRetry}
          className="ml-1 shrink-0 rounded bg-white/15 px-2 py-1 text-[11px] font-bold text-white hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          Retry AI
        </button>
      </StatusStrip>
    );
  }

  if (reconnecting) {
    return (
      <StatusStrip tone="amber">
        <strong>AI reconnecting</strong>
        <span>Keep presenting manually. It is retrying in the background.</span>
      </StatusStrip>
    );
  }

  return null;
}

function StatusStrip({ children, tone }: { children: React.ReactNode; tone: "amber" | "red" }) {
  const colors = tone === "red"
    ? { background: "rgba(127, 29, 29, 0.96)", border: "#ef4444" }
    : { background: "rgba(120, 53, 15, 0.96)", border: "#f59e0b" };
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-2 left-1/2 z-[9998] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-md border px-3 py-2 text-[12px] text-white shadow-lg"
      style={{ background: colors.background, borderColor: colors.border }}
    >
      {children}
    </div>
  );
}
