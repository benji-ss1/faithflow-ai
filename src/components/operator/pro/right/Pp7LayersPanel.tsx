"use client";
/**
 * Pp7LayersPanel — the ProPresenter 7 Layers panel (2026-09-17).
 *
 * Replaces the legacy LayersPanel while `usePp7Layers()` is on. It is the same
 * seven layers as the clear rail beside the preview, in the same PP7 order
 * (Audio, Messages, Props, Announcements, Slide, Media, Video Input), reading
 * and clearing through the SAME shared model (`src/lib/pp7-layer-model.ts`), so
 * the two surfaces can never disagree.
 *
 * PP7 differences from the legacy panel, deliberate:
 *   - no eye / hide toggles (ProPresenter has no hide; clear is the verb)
 *   - no "lit = live" legend, no strikethrough, no "Cleared" chip
 *   - no press-and-HOLD Clear All — it is the circled ✕, exactly like the rail
 *   - "Background" → Media, "Camera" → Video Input, "Logo" → Props
 *
 * Kept from the legacy panel because PP7 has them and they have no other home
 * in PresentFlow: the Media swap picker (Background Templates), the Props
 * picker (church logo), the Slide zone Full/Lower-third, and Slide Actions
 * (re-send / jump). Components are reused verbatim from LayersPanel.
 *
 * Windows (docs/WINDOWS_DESIGN.md): no ⌘-only labels (F-keys are named as
 * F1–F7, which Windows sends without Fn), no hover-only affordances (every
 * control is a visible button with a text/aria label), ≥28px hit targets, and
 * the panel scrolls rather than overflowing at 125/150 % scaling.
 */
import { useState } from "react";
import {
  Music, Send, Layers as LayersIcon, Megaphone, SquareMenu, Image as ImageIcon, Video,
  X, RectangleHorizontal, Square, ListOrdered, Award, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { OperatorShellCtx } from "../../shell/types";
import { BackgroundSelector } from "@/backgrounds/components/BackgroundSelector";
import {
  PP7_CLEAR_ORDER, PP7_CLEAR_LABEL, PP7_CLEAR_KEY, type Pp7ClearLayer,
} from "@/lib/pp7-clear";
import {
  PP7_LAYER_AVAILABLE, pp7ClearAll, pp7ClearLayer, pp7LayerActive,
} from "@/lib/pp7-layer-model";
import { usePp7LayerInputs, usePp7ClearEffects } from "./usePp7Layers";
import { BackgroundThumb, LogoSwap, SlideActions } from "./LayersPanel";

const ICONS: Record<Pp7ClearLayer, React.ComponentType<{ className?: string }>> = {
  audio: Music,
  messages: Send,
  props: LayersIcon,
  announcements: Megaphone,
  slide: SquareMenu,
  media: ImageIcon,
  videoInput: Video,
};

/** PP7 rail colours, reused so the panel reads as the same object as the rail. */
const CELL_ACTIVE = "#7a1f1f";

type SubPanel = "media" | "props" | "slide" | null;

export function Pp7LayersPanel({
  ctx,
  messagesActive,
  onClearMessages,
}: {
  ctx: OperatorShellCtx;
  messagesActive: boolean;
  onClearMessages: () => void;
}) {
  const [open, setOpen] = useState<SubPanel>(null);
  const toggle = (p: SubPanel) => setOpen((v) => (v === p ? null : p));

  const inputs = usePp7LayerInputs(ctx, messagesActive);
  const effects = usePp7ClearEffects(ctx, onClearMessages);
  const active = pp7LayerActive(inputs);

  if (!ctx.layersEngineOn) {
    return (
      <div className="p-3 text-[12px] leading-relaxed text-[var(--color-muted-foreground)]" role="note">
        The layers engine is in early access. It lets you control media, slide,
        video input and props independently while live. Contact PresentFlow to
        enable it for your church.
      </div>
    );
  }

  const slideRow = ctx.liveLayers.rows.find((r) => r.id === "slide");
  const isLowerThird = slideRow?.zone.kind === "lowerThird";
  const zoneDisabled = ctx.liveSlide?.kind !== "text";

  return (
    // Scrolls rather than overflowing (Windows 125/150 % scaling).
    <div className="flex flex-col max-h-[70vh] overflow-y-auto pf-transcript-scroll">
      <div className="flex flex-col divide-y divide-[var(--color-border)]">
        {PP7_CLEAR_ORDER.map((layer) => {
          const Icon = ICONS[layer];
          const available = PP7_LAYER_AVAILABLE[layer];
          const isLive = active[layer];
          const key = PP7_CLEAR_KEY[layer];
          return (
            <div key={layer} className="flex flex-col">
              <div
                className="flex items-center gap-1.5 px-2 py-1.5"
                data-layer={layer}
                data-active={isLive ? "true" : "false"}
              >
                <span
                  aria-label={isLive ? `${PP7_CLEAR_LABEL[layer]} is live` : `${PP7_CLEAR_LABEL[layer]} is idle`}
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{
                    background: isLive ? CELL_ACTIVE : "var(--color-border)",
                    boxShadow: isLive ? `0 0 8px ${CELL_ACTIVE}` : "none",
                  }}
                />
                <Icon className={cn("w-3.5 h-3.5 shrink-0", available ? "text-[var(--color-foreground)]" : "text-[var(--color-muted-foreground)] opacity-50")} />
                <span className={cn("flex-1 min-w-0 truncate text-[12px]", available ? "text-[var(--color-foreground)]" : "text-[var(--color-muted-foreground)] opacity-60")}>
                  {PP7_CLEAR_LABEL[layer]}
                  {!available && <span className="ml-1.5 text-[10px] uppercase tracking-wider opacity-70">coming soon</span>}
                </span>

                {/* Slide zone (Full / Lower third) — this live output only. */}
                {layer === "slide" && (
                  <button
                    type="button"
                    disabled={zoneDisabled}
                    onClick={() => {
                      if (zoneDisabled || !slideRow) return;
                      ctx.liveLayers.setZone(slideRow.id, isLowerThird ? { kind: "full" } : { kind: "lowerThird" });
                    }}
                    title={zoneDisabled ? "Zones apply to text slides" : isLowerThird ? "Lower third — tap for full. This live output only." : "Full — tap for lower third. This live output only."}
                    aria-label={zoneDisabled ? "Zones apply to text slides" : isLowerThird ? "Switch slide to full (this live output only)" : "Switch slide to lower third (this live output only)"}
                    className={cn(ROW_BTN, zoneDisabled ? "opacity-40 cursor-not-allowed" : "hover:bg-white/5")}
                  >
                    {isLowerThird ? <RectangleHorizontal className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                  </button>
                )}

                {/* Slide actions — re-send / jump. */}
                {layer === "slide" && (
                  <button
                    type="button"
                    onClick={() => toggle("slide")}
                    title="Slide actions"
                    aria-label="Slide actions"
                    aria-expanded={open === "slide"}
                    className={cn(ROW_BTN, "hover:bg-white/5", open === "slide" && "text-[var(--color-brand)]")}
                  >
                    <ListOrdered className="w-3.5 h-3.5" />
                  </button>
                )}

                {/* Media swap — the Background Templates picker, PP7-named. */}
                {layer === "media" && (
                  <button
                    type="button"
                    onClick={() => toggle("media")}
                    title="Change media"
                    aria-label="Change media"
                    aria-expanded={open === "media"}
                    className={cn(ROW_BTN, "hover:bg-white/5", open === "media" && "text-[var(--color-brand)]")}
                  >
                    <BackgroundThumb bg={ctx.background ?? null} />
                  </button>
                )}

                {/* Props — the church logo prop. */}
                {layer === "props" && (
                  <button
                    type="button"
                    onClick={() => toggle("props")}
                    title="Choose prop (church logo)"
                    aria-label="Choose prop (church logo)"
                    aria-expanded={open === "props"}
                    className={cn(ROW_BTN, "hover:bg-white/5", open === "props" && "text-[var(--color-brand)]")}
                  >
                    {ctx.appearance?.logoUrl
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={ctx.appearance.logoUrl} alt="" className="block w-5 h-5 rounded-[3px] object-contain ring-1 ring-white/15" />
                      : <Award className="w-3.5 h-3.5" />}
                  </button>
                )}

                {/* Per-layer clear — the only destructive control on the row. */}
                <button
                  type="button"
                  disabled={!available}
                  onClick={() => { if (available) pp7ClearLayer(layer, inputs, effects); }}
                  title={available ? `Clear ${PP7_CLEAR_LABEL[layer]}${key ? ` (${key})` : ""}` : `${PP7_CLEAR_LABEL[layer]} (coming soon)`}
                  aria-label={available ? `Clear ${PP7_CLEAR_LABEL[layer]}${key ? ` (${key})` : ""}` : `${PP7_CLEAR_LABEL[layer]} (coming soon)`}
                  data-clear={layer}
                  className={cn(
                    ROW_BTN, "ml-1 rounded-full",
                    !available
                      ? "opacity-30 cursor-not-allowed"
                      : isLive
                        ? "bg-[#7a1f1f] text-white hover:bg-[#8f2626]"
                        : "text-[var(--color-muted-foreground)] hover:bg-white/5 hover:text-red-400",
                  )}
                >
                  <X className="w-3.5 h-3.5" strokeWidth={3} />
                </button>
              </div>

              {/* Row sub-panels render directly under their row. */}
              {layer === "media" && open === "media" && (
                <div className="border-t border-[var(--color-border)] p-2 max-h-[280px] overflow-y-auto pf-transcript-scroll">
                  <BackgroundSelector />
                  <div className="mt-2 flex items-center gap-1.5 text-[10px] text-[var(--color-muted-foreground)]" role="note">
                    <Check className="w-3 h-3" />
                    Applied live · saved automatically
                  </div>
                </div>
              )}
              {layer === "props" && open === "props" && <LogoSwap logoUrl={ctx.appearance?.logoUrl ?? null} />}
              {layer === "slide" && open === "slide" && <SlideActions ctx={ctx} />}
            </div>
          );
        })}
      </div>

      {/* Clear All — PP7's circled ✕, same action as the rail's and F1. */}
      <div className="border-t border-[var(--color-border)] p-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => pp7ClearAll(inputs, effects)}
          title="Clear All (F1)"
          aria-label="Clear All (F1)"
          data-clear="all"
          className="w-7 h-7 shrink-0 rounded-full bg-white text-[#1c1c1e] flex items-center justify-center shadow hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <X className="w-4 h-4" strokeWidth={3} />
        </button>
        <span className="text-[11px] text-[var(--color-muted-foreground)]">Clear All · F1</span>
      </div>
    </div>
  );
}

/** ≥28px hit target, visible focus ring (no hover-only affordances). */
const ROW_BTN =
  "shrink-0 w-7 h-7 inline-flex items-center justify-center rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]";
