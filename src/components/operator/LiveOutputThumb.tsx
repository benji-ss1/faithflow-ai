"use client";
// Always-visible live-output thumbnail anchored to the top-right of the
// OperatorShell. Red border when live is non-empty (something is on
// the projector), dim/black when cleared. Renders the last-sent slide
// via SlideRenderer at reduced size (no canvas snapshot API is exposed
// today; the SlidePayload is authoritative).

import { SlideRenderer } from "@/components/live/SlideRenderer";
import type { SlidePayload } from "@/lib/broadcast";

export function LiveOutputThumb({
  liveSlide,
  outputStatus,
}: {
  liveSlide: SlidePayload;
  outputStatus?: string | null;
}) {
  const isLive = liveSlide.kind !== "empty";
  const status = outputStatus ?? (isLive ? "Projector · 1920×1080" : "No output configured");

  return (
    <div className="flex flex-col items-end gap-1 shrink-0" title={isLive ? "Live output preview" : "Live output cleared"}>
      <div
        className="relative rounded-sm overflow-hidden border-2"
        style={{
          width: 200,
          height: 112,
          background: "#000",
          borderColor: isLive ? "rgba(239,68,68,0.9)" : "#2a3232",
          boxShadow: isLive ? "0 0 0 1px rgba(239,68,68,0.35)" : undefined,
        }}
      >
        {isLive ? (
          <div className="absolute inset-0"><SlideRenderer slide={liveSlide} /></div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] uppercase tracking-[0.18em] text-zinc-600">
            Off-Air
          </div>
        )}
        {isLive && (
          <span className="absolute top-1 left-1 inline-flex items-center gap-1 rounded-sm bg-red-600/90 text-white text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> Live
          </span>
        )}
      </div>
      <div className="text-[10px] font-mono text-zinc-400 leading-tight">{status}</div>
    </div>
  );
}
