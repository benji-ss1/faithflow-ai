"use client";
/**
 * BibleBrowserMode — thin wrapper around the ProPresenter-style BiblePanel.
 *
 * Kept as a distinct file so existing WorkspaceTabs consumers keep working;
 * all real behaviour lives in BiblePanel.
 */
import { BiblePanel } from "@/components/library/BiblePanel";
import type { SlidePayload, TransitionSpec } from "@/lib/broadcast";
import type { Detection } from "@/components/operator/useAudioStream";

export function BibleBrowserMode({
  onSendPreview, onSendLive, defaultTranslationCode,
  detections, autoApproveEnabled, autoApproveThreshold, autoSendToLive,
  transitionSpec, onSetTransitionSpec, onBankAdd,
}: {
  onSendPreview: (slide: SlidePayload) => void;
  onSendLive: (slide: SlidePayload) => void;
  defaultTranslationCode: string;
  detections?: Detection[];
  autoApproveEnabled?: boolean;
  autoApproveThreshold?: number;
  autoSendToLive?: boolean;
  transitionSpec?: TransitionSpec | null;
  onSetTransitionSpec?: (t: TransitionSpec | null) => void;
  onBankAdd?: (ref: { book: string; chapter: number; verseStart: number; verseEnd: number }) => Promise<unknown>;
}) {
  return (
    <BiblePanel
      defaultTranslationCode={defaultTranslationCode}
      onSendSlideToLive={(slide) => onSendLive(slide)}
      onStageSlide={(slide) => onSendPreview(slide)}
      onBankAdd={onBankAdd ?? (async () => null)}
      transitionSpec={transitionSpec ?? null}
      onSetTransitionSpec={onSetTransitionSpec ?? (() => { /* noop */ })}
      detections={detections ?? []}
      autoApproveEnabled={autoApproveEnabled ?? false}
      autoApproveThreshold={autoApproveThreshold ?? 90}
      autoSendToLive={autoSendToLive ?? false}
    />
  );
}
