"use client";
import { cn } from "@/lib/utils";

/**
 * VoiceNote — an animated listening waveform for the AI voice pipeline (adapted
 * from the requested reference to a compact, always-live indicator). When
 * `active`, the bars pulse to signal the AI is hearing audio; when idle they
 * settle flat. Purely visual; drives nothing.
 */
export function VoiceNote({ active, className, color = "var(--color-brand)", bars = 5 }: {
  active: boolean;
  className?: string;
  color?: string;
  bars?: number;
}) {
  return (
    <span className={cn("inline-flex items-center gap-[3px] h-3.5", className)} aria-hidden>
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full"
          style={{
            height: "100%",
            background: color,
            transformOrigin: "center",
            transform: active ? undefined : "scaleY(0.3)",
            opacity: active ? 1 : 0.5,
            animation: active ? `pfListenWave 1s ease-in-out ${(i * 0.13).toFixed(2)}s infinite` : "none",
            transition: "transform .2s ease, opacity .2s ease",
          }}
        />
      ))}
    </span>
  );
}
