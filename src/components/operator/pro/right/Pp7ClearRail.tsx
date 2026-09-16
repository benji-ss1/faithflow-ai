"use client";
/**
 * Pp7ClearRail — ProPresenter 7 clear rail, on the right edge of the preview.
 *
 * Matches PP7 (docs/PP7_BLUEPRINT.md, verified from screenshots): a narrow
 * column of layer buttons, top → bottom Audio, Messages, Props, Announcements,
 * Slide, Media, Video Input. The column turns maroon while anything is live and
 * each layer with content gets a red cell. Clear All is the white circled ✕ on
 * the column's left edge. Every button clears ONLY its own layer, and the same
 * clears run from F1–F7.
 *
 * Only mounted when the PP7 layers flag is on. Reuses existing actions:
 * slide = onKill, media = background store / media slide, video input + props
 * (theme logo) = liveLayers.clearLayer, announcements = onSetAnnouncement(null),
 * messages = legacy composer + message board.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Music, Send, Layers, Megaphone, SquareMenu, Image as ImageIcon, Video, X } from "lucide-react";
import type { OperatorShellCtx } from "../../shell/types";
import { setActiveBackgroundId } from "@/backgrounds/store/backgroundStore";
import { clearVideoInputLive } from "@/lib/video-input-clear";
import { shouldIgnore, anyOverlayOpen } from "@/hooks/useOperatorHotkeys";
import {
  PP7_CLEAR_ORDER, PP7_CLEAR_LABEL, PP7_CLEAR_KEY, decodePp7ClearKey,
  isMediaSlideKind, isEmptySlideKind, type Pp7ClearLayer,
} from "@/lib/pp7-clear";

const ICONS: Record<Pp7ClearLayer, React.ComponentType<{ className?: string }>> = {
  audio: Music,
  messages: Send,
  props: Layers,
  announcements: Megaphone,
  slide: SquareMenu,
  media: ImageIcon,
  videoInput: Video,
};

// PP7 rail colours (from screenshots).
const COLUMN_IDLE = "#1c1c1e";
const COLUMN_LIVE = "#4a1515";

export function Pp7ClearRail({
  ctx,
  messagesActive,
  onClearMessages,
}: {
  ctx: OperatorShellCtx;
  messagesActive: boolean;
  onClearMessages: () => void;
}) {
  const kind = ctx.liveSlide?.kind;
  const row = useCallback(
    (id: string) => ctx.liveLayers.rows.find((r) => r.id === id),
    [ctx.liveLayers.rows],
  );

  const active: Record<Pp7ClearLayer, boolean> = useMemo(() => ({
    audio: false, // no audio layer yet
    messages: messagesActive,
    props: !!row("logo")?.active,
    announcements: !!ctx.announcement,
    slide: !isEmptySlideKind(kind) && !isMediaSlideKind(kind) && !!row("slide")?.active,
    // Background row is off while a camera is live (legacy plan), but under PP7
    // order the media still paints over the camera — read the base too.
    media: !!row("background")?.active || (!!ctx.background && ctx.background.type !== "none" && !!ctx.videoInput) || (isMediaSlideKind(kind) && !!row("slide")?.active),
    videoInput: !!ctx.videoInput && !!row("camera")?.active,
  }), [messagesActive, row, ctx.announcement, ctx.background, ctx.videoInput, kind]);

  const available: Record<Pp7ClearLayer, boolean> = {
    audio: false, messages: true, props: true, announcements: true, slide: true, media: true, videoInput: true,
  };

  const clear = useCallback((layer: Pp7ClearLayer) => {
    switch (layer) {
      case "slide":
        if (!isMediaSlideKind(ctx.liveSlide?.kind)) ctx.onKill();
        return;
      case "media":
        setActiveBackgroundId("none");
        // A background override can show while the base store is already none
        // (e.g. a Layers-panel swap) — clear the layer too so it really goes.
        if (row("background")?.active) ctx.liveLayers.clearLayer("background");
        if (isMediaSlideKind(ctx.liveSlide?.kind)) ctx.onKill();
        return;
      case "videoInput":
        // Stop the feed like the camera panel's Clear, so it can go live again.
        if (ctx.videoInput) clearVideoInputLive();
        return;
      case "props":
        if (row("logo")?.active) ctx.liveLayers.clearLayer("logo");
        return;
      case "announcements":
        ctx.onSetAnnouncement(null);
        return;
      case "messages":
        onClearMessages();
        return;
      case "audio":
        return;
    }
  }, [ctx, row, onClearMessages]);

  // Clear All = every PP7 layer clear, plus the livestream lower third. Runs the
  // per-layer clears (not liveLayers.clearAll) so nothing is left permanently
  // disabled — the camera, media and slide all work normally afterwards.
  const clearAll = useCallback(() => {
    for (const layer of PP7_CLEAR_ORDER) clear(layer);
    ctx.onClearLowerThird?.();
  }, [ctx, clear]);

  // F1–F7 (PP7 shortcuts). Ignored while typing, with modifiers, or while a
  // dialog/menu is open (same guard as the operator hotkeys). Audio (F5) has no
  // layer yet, so F5 is left alone (browser reload keeps working).
  const handlersRef = useRef({ clear, clearAll });
  handlersRef.current = { clear, clearAll };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.defaultPrevented || shouldIgnore(e.target) || anyOverlayOpen()) return;
      const target = decodePp7ClearKey(e);
      if (!target || target === "audio") return;
      e.preventDefault();
      if (target === "all") handlersRef.current.clearAll();
      else handlersRef.current.clear(target);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const anyLive = PP7_CLEAR_ORDER.some((l) => active[l]);

  return (
    <div
      className="relative shrink-0 w-10 flex flex-col"
      style={{ background: anyLive ? COLUMN_LIVE : COLUMN_IDLE }}
      role="toolbar"
      aria-orientation="vertical"
      aria-label="Clear layers"
    >
      {PP7_CLEAR_ORDER.map((layer, i) => {
        const Icon = ICONS[layer];
        const key = PP7_CLEAR_KEY[layer];
        const label = available[layer]
          ? `Clear ${PP7_CLEAR_LABEL[layer]}${key ? ` (${key})` : ""}${active[layer] ? " — live" : ""}`
          : `${PP7_CLEAR_LABEL[layer]} (coming soon)`;
        return (
          <button
            key={layer}
            type="button"
            aria-disabled={!available[layer]}
            onClick={() => { if (available[layer]) clear(layer); }}
            title={label}
            aria-label={label}
            data-active={active[layer] ? "true" : "false"}
            className={`flex-1 min-h-0 flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70 ${i > 0 ? "border-t border-black/40" : ""} ${!available[layer] ? "cursor-default" : active[layer] ? "bg-[#7a1f1f] hover:bg-[#8f2626]" : "hover:bg-white/10"}`}
          >
            <Icon className={`w-4 h-4 ${available[layer] ? "text-white/85" : "text-white/25"}`} />
          </button>
        );
      })}

      {/* Clear All — PP7's white circled ✕ on the rail's left edge. */}
      <button
        type="button"
        onClick={clearAll}
        title="Clear All (F1)"
        aria-label="Clear All (F1)"
        className="absolute top-1/2 -left-3 -translate-y-1/2 z-20 w-6 h-6 rounded-full bg-white text-[#1c1c1e] flex items-center justify-center shadow hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <X className="w-4 h-4" strokeWidth={3} />
      </button>
    </div>
  );
}
