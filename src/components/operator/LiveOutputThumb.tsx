"use client";
// Always-visible live-output thumbnail anchored to the top-right of the
// OperatorShell. Red border when live is non-empty (something is on
// the projector), dim/black when cleared. Renders the last-sent slide
// via SlideRenderer at reduced size (no canvas snapshot API is exposed
// today; the SlidePayload is authoritative).

import { SlideRenderer } from "@/components/live/SlideRenderer";
import { BackgroundLayer } from "@/backgrounds/components/BackgroundLayer";
import type { SlidePayload, BackgroundSpec, VideoInputState } from "@/lib/broadcast";

export function LiveOutputThumb({
  liveSlide,
  outputStatus,
  appearance,
  fontScale,
  background,
  videoInput,
}: {
  liveSlide: SlidePayload;
  outputStatus?: string | null;
  // Bug-fix 2026-08-11 (font mismatch): pass the active theme appearance so
  // this "what the projector shows" thumb renders with the SAME font/theme as
  // the real output, not the operator default.
  appearance?: import("@/lib/broadcast").ThemeAppearance | null;
  // 2026-08-13 (text-size match): projectorFit + fontScale so this 16:9 thumb
  // sizes text at the SAME fraction-of-height as the real projector.
  fontScale?: number;
  // 2026-08-28 (projector-honesty): the active Background Template. This thumb
  // is labelled "what the projector shows", but it used to omit the template
  // layer AND overVideo, so it painted the theme background even when /live was
  // showing a template instead — the exact "theme in preview, not on projector"
  // mismatch. Mirror /live: render the template behind and, when it's active,
  // make the slide transparent (overVideo) so the template shows through.
  background?: BackgroundSpec | null;
  // A live camera wins over a Background Template on /live (page.tsx:483 gates
  // overVideo AND the template layer on !videoInput). Mirror that here so the
  // thumb never shows a template shader while the projector shows the camera.
  videoInput?: VideoInputState | null;
}) {
  const isLive = liveSlide.kind !== "empty";
  const status = outputStatus ?? (isLive ? "Projector · 1920×1080" : "No output configured");
  // IDENTICAL to /live's overVideo formula (background active AND no live camera).
  const templateActive = !!(background && background.type !== "none" && !videoInput);

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
          <div className="absolute inset-0">
            {/* Template BEHIND the slide, exactly as /live composes it.
                `frozen`: one static frame (no permanent RAF / 2nd video decode)
                — this decorative 200×112 thumb only needs the template's colour. */}
            {templateActive && <BackgroundLayer background={background} frozen />}
            <SlideRenderer slide={liveSlide} appearance={appearance ?? undefined} projectorFit fontScale={fontScale} overVideo={templateActive} />
          </div>
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
