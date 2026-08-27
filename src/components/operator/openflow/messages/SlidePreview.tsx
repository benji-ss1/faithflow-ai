"use client";
/*
 * OpenFlowSlidePreview — a real, theme-accurate mini slide, rendered through the
 * SAME ThemedSlideCard the operator grid and projector use. So a plan preview in
 * OpenFlow looks byte-identical to what will actually go live. Used for the
 * block thumbnails and the expandable per-block slide lists.
 */
import { ThemedSlideCard } from "@/components/operator/pro/center/ThemedSlideCard";
import type { OpenFlowActions } from "@/lib/openflow/types";
import type { SlidePayload } from "@/lib/broadcast";

export function OpenFlowSlidePreview({
  slide, actions, className, textMinPx = 10,
}: {
  slide: SlidePayload;
  actions: Pick<OpenFlowActions, "appearance" | "background">;
  className?: string;
  textMinPx?: number;
}) {
  return (
    <div className={`of-preview${className ? ` ${className}` : ""}`}>
      <ThemedSlideCard
        slide={slide}
        appearance={actions.appearance ?? undefined}
        background={actions.background}
        textMinPx={textMinPx}
      />
    </div>
  );
}
