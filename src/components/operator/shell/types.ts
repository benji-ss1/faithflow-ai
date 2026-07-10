"use client";
/**
 * Prop bag passed from OperatorConsole down into the new Phase 5C shell.
 * The Console still owns all state, handlers, refs, and BroadcastChannel;
 * the shell is a pure layout composer.
 */
import type { ExpandedPlan } from "@/lib/server/services";
import type { SlidePayload } from "@/lib/broadcast";
import type { AudioStreamState, Detection, SongSuggestion, CommandSuggestion, UnifiedSuggestion } from "../useAudioStream";
import type { BankedVerse } from "../useVerseBank";
import type { InternetMetadataCard } from "../AIAssistantPanel";
import type { AutopilotMode } from "../OperatorConsole";

export type OperatorShellCtx = {
  plan: ExpandedPlan;
  previewSlide: SlidePayload;
  liveSlide: SlidePayload;
  previewItemIdx: number;
  previewSlideIdx: number;
  liveItemIdx: number;

  aspectRatio: "16:9" | "4:3" | "custom";
  fitMode: "contain" | "fill" | "crop";
  safeArea: boolean;
  onAspectChange: (a: "16:9" | "4:3" | "custom") => void;
  onFitChange: (f: "contain" | "fill" | "crop") => void;
  onSafeAreaToggle: () => void;

  autopilotMode: AutopilotMode;
  onAutopilotModeChange: (m: AutopilotMode) => void;
  autoApproveOn: boolean;
  autoSendToLive: boolean;

  audio: AudioStreamState;
  onListenToggle: () => void;
  confidenceThreshold: number;
  defaultTranslationCode: string;

  onJumpSlide: (itemIdx: number, slideIdx: number) => void;
  onSetPreviewItem: (itemIdx: number) => void;
  onSendToLive: () => void;
  onBlank: () => void;
  onLogo: () => void;
  onKill: () => void;
  onClearSlide: () => void;
  onClearMedia: () => void;
  onClearLowerThird: () => void;
  onStageMessage: () => void;
  onSendLowerThird: (line1: string, line2: string) => void;
  onStartCountdown: (seconds: number) => void;
  countdownEndsAt: number | null;

  onOpenProjector: () => void;
  onOpenStage: () => void;
  onOpenStream: () => void;

  planId: string;
  endServiceHasTranscript: boolean;

  // AI-tab wiring
  bank: BankedVerse[];
  currentBankIdx: number | null;
  onRecallBanked: (idx: number) => void;
  onApproveDetection: (d: Detection) => void;
  onRejectDetection: (d: Detection) => void;
  onApproveSong: (s: SongSuggestion) => void;
  onRejectSong: (s: SongSuggestion) => void;
  onEditSong: (s: SongSuggestion) => void;
  onApproveCommand: (c: CommandSuggestion) => void;
  onRejectCommand: (c: CommandSuggestion) => void;
  onEditCommand: (c: CommandSuggestion) => void;
  onPreviewUnified: (s: UnifiedSuggestion) => void;
  onSendLiveUnified: (s: UnifiedSuggestion) => void;
  onQueueUnified: (s: UnifiedSuggestion) => void;
  onRejectUnified: (s: UnifiedSuggestion) => void;
  onImportSong: (title: string) => void;
  internetMatches: InternetMetadataCard[];
  onInternetSearchLibrary: (m: InternetMetadataCard) => void;
  onInternetImport: (m: InternetMetadataCard) => void;
  onInternetCreateDraft: (m: InternetMetadataCard) => void;
  onInternetReject: (m: InternetMetadataCard) => void;
  onSimulate: (text: string) => void;

  historyKey: number;
};

export type InspectorTab =
  | "output" | "messages" | "props" | "audio"
  | "layers" | "ai" | "stage" | "status"
  | "slide" | "text" | "shape";
