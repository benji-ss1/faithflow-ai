"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, ChevronLeft, ChevronRight, Monitor, Radio, Square, Sun, PanelRightClose, PanelRightOpen } from "lucide-react";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import { openLiveChannel, safePost, type SlidePayload, type LiveMessage, type OutputState } from "@/lib/broadcast";
import type { ExpandedPlan, ExpandedItem } from "@/lib/server/services";
import { cn } from "@/lib/utils";
import { useAudioStream, type Detection, type SongSuggestion, type CommandSuggestion } from "./useAudioStream";
import { AIAssistantPanel, ListeningToggle } from "./AIAssistantPanel";
import { updateDetectionStatus, updateAiSuggestionStatus } from "@/lib/actions";
import { SuggestionHistory } from "./SuggestionHistory";
import { EditSuggestionModal, type EditableSuggestion } from "./EditSuggestionModal";
import { transition } from "@/lib/autopilot";
import { useVerseBank, type BankedVerse } from "./useVerseBank";
import { parseContextCommand } from "@/lib/context-parser";
import { Bookmark, Zap } from "lucide-react";
import { ProductionRail, type RailSection } from "./ProductionRail";
import { WorkspaceTabs, type WorkspaceMode } from "./WorkspaceTabs";
import { OutputStack } from "./OutputStack";
import { BottomTray } from "./BottomTray";
import { EndServiceButton } from "./EndServiceButton";

type Cursor = { itemIdx: number; slideIdx: number };

export type AutoApproveConfig = {
  enabled: boolean;
  confidenceFloor: number;   // 0-100
  autoSendToLive: boolean;   // if true + enabled, skip Preview altogether
};

/**
 * Four-mode autopilot state (Phase 5). The existing AutoApproveConfig
 * boolean maps onto this: mode === "active"  ⇒  enabled = true.
 *
 *   manual     — no AI listening, no suggestions
 *   suggestion — AI listens, suggestions shown, EVERY action needs approval
 *   armed      — autopilot primed but not firing; warns operator that
 *                promoting to "active" WILL auto-approve the next
 *                high-confidence scripture detection
 *   active     — high-confidence scripture detections auto-stage (and
 *                optionally auto-send when autoSendToLive is on)
 */
export type AutopilotMode = "manual" | "suggestion" | "armed" | "active";

const AUTOPILOT_MODE_KEY = "faithflow.autopilot.mode";

export function OperatorConsole({ plan, defaultTranslationCode, confidenceThreshold, autoApprove: autoApproveProp }: {
  plan: ExpandedPlan;
  defaultTranslationCode: string;
  confidenceThreshold: number;
  autoApprove: AutoApproveConfig;
}) {
  // --- Four-mode autopilot (Phase 5) ---------------------------------------
  // On page load we ALWAYS downgrade "active" to "armed" as a safety
  // measure — the operator must consciously re-arm live-firing every session.
  const [autopilotMode, setAutopilotModeInner] = useState<AutopilotMode>(() => {
    if (typeof window === "undefined") return autoApproveProp.enabled ? "armed" : "suggestion";
    try {
      const raw = window.localStorage.getItem(AUTOPILOT_MODE_KEY);
      if (raw === "manual" || raw === "suggestion" || raw === "armed") return raw;
      if (raw === "active") return "armed"; // safety downgrade on reload
    } catch { /* noop */ }
    return autoApproveProp.enabled ? "armed" : "suggestion";
  });
  const setAutopilotMode = useCallback((next: AutopilotMode) => {
    setAutopilotModeInner((prev) => {
      if (prev === next) return prev;
      // Confirm transition into "active"
      if (next === "active") {
        const ok = typeof window !== "undefined"
          ? window.confirm("Turn on AUTOPILOT ACTIVE?\n\nHigh-confidence scripture detections will auto-approve without operator input. Continue?")
          : true;
        if (!ok) return prev;
        toast.warning("Autopilot ACTIVE — next high-confidence detection will auto-stage.", { duration: 4000 });
      }
      try { window.localStorage.setItem(AUTOPILOT_MODE_KEY, next); } catch { /* noop */ }
      return next;
    });
  }, []);
  // Derived AutoApproveConfig — only "active" enables the existing
  // auto-approve pipeline. Everything else is enabled=false so approvals
  // stay in operator hands.
  const autoApprove = useMemo<AutoApproveConfig>(() => ({
    enabled: autopilotMode === "active",
    confidenceFloor: autoApproveProp.confidenceFloor,
    autoSendToLive: autoApproveProp.autoSendToLive,
  }), [autopilotMode, autoApproveProp.confidenceFloor, autoApproveProp.autoSendToLive]);
  const [preview, setPreview] = useState<Cursor>({ itemIdx: 0, slideIdx: 0 });
  const [live, setLive] = useState<SlidePayload>({ kind: "empty" });
  const [autoSend, setAutoSend] = useState(false);
  // AI staging state — a scripture slide from an approved detection lives
  // here. When non-null it OVERRIDES the preview cursor's slide, but never
  // reaches Live unless the operator hits the orange SEND TO LIVE button.
  const [stagedAISlide, setStagedAISlide] = useState<SlidePayload | null>(null);
  // Phase 5 — track staged song so voice commands ("show chorus", "go to
  // verse 2") can jump within it. Populated by approveSong; cleared when
  // stagedAISlide is manually cleared.
  const [stagedSong, setStagedSong] = useState<{ slides: SlidePayload[]; currentIdx: number } | null>(null);
  // Countdown target — piggybacks OutputState.countdownEndsAt. Declared here
  // so the OutputState effect below can reference it.
  const [countdownEndsAt, setCountdownEndsAt] = useState<number | null>(null);
  const [aiPanelOpen, setAiPanelOpen] = useState(true);
  // --- Cockpit UI state (Phase 1/2) ----------------------------------------
  const [railSection, setRailSection] = useState<RailSection>("service");
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("flow");
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "4:3" | "custom">("16:9");
  const [fitMode, setFitMode] = useState<"contain" | "fill" | "crop">("contain");
  const [safeArea, setSafeArea] = useState(false);

  // Compute next-slide payload for /stage
  const nextSlideForStage: SlidePayload | null = (() => {
    const item = plan.items[preview.itemIdx];
    if (!item) return null;
    if (preview.slideIdx + 1 < item.slides.length) return item.slides[preview.slideIdx + 1];
    const nextItem = plan.items[preview.itemIdx + 1];
    return nextItem?.slides[0] ?? null;
  })();

  // Push extended OutputState on every relevant change so /stage and
  // /livestream get item labels + next-slide + lower-third data without
  // rewriting them. Piggybacks on the existing BroadcastChannel — /live
  // still consumes the legacy `set` messages elsewhere.
  useEffect(() => {
    const state: OutputState = {
      live,
      next: nextSlideForStage,
      itemTitle: plan.items[preview.itemIdx]?.title || "",
      slideNumber: `${preview.slideIdx + 1} / ${plan.items[preview.itemIdx]?.slides.length || 0}`,
      aspectRatio,
      fitMode,
      safeArea,
      operatorMessage: null,
      lowerThird: null,
      countdownEndsAt,
    };
    safePost(chRef.current, { type: "output", state });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, preview.itemIdx, preview.slideIdx, aspectRatio, fitMode, safeArea, plan.items, countdownEndsAt]);
  const chRef = useRef<BroadcastChannel | null>(null);
  const liveRef = useRef<SlidePayload>(live);
  liveRef.current = live;

  const { state: audio, start: startAudio, stop: stopAudio, dismissDetection, dismissSong, dismissCommand } = useAudioStream(plan.id);

  // In "manual" mode we force the audio stream off — no suggestions at all.
  useEffect(() => {
    if (autopilotMode === "manual" && audio.listening) stopAudio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autopilotMode, audio.listening]);

  // Verse bank: per-service history of approved refs + ±5 preload window
  const { bank, currentRef: currentBankRef, addReference: bankAdd, advanceOne: bankAdvance, jumpTo: bankJumpTo, clear: bankClear, bankedToSlide } = useVerseBank(defaultTranslationCode);
  const processedSegments = useRef<Set<string>>(new Set()); // dedupe context-cmd firing
  const processedAutoApproved = useRef<Set<string>>(new Set()); // detection IDs we've auto-approved
  // Autopilot activity indicator — when non-null, the last Preview/Live
  // change was made by autopilot (auto-approve OR contextual nav).
  // Displayed as a visible chip on both panes so the operator is never
  // confused about why something appeared without them clicking.
  const [autopilotActivity, setAutopilotActivity] = useState<null | { source: "auto-approve" | "context-verse" | "context-slide"; ref: string; ts: number }>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const bumpHistory = useCallback(() => setHistoryKey((k) => k + 1), []);
  const [editing, setEditing] = useState<EditableSuggestion | null>(null);
  // Fade the chip after 8s of inactivity
  useEffect(() => {
    if (!autopilotActivity) return;
    const t = setTimeout(() => setAutopilotActivity(null), 8000);
    return () => clearTimeout(t);
  }, [autopilotActivity]);

  const previewSlide: SlidePayload = useMemo(() => {
    if (stagedAISlide) return stagedAISlide;
    const item = plan.items[preview.itemIdx];
    if (!item) return { kind: "empty" };
    return item.slides[preview.slideIdx] || { kind: "empty" };
  }, [plan.items, preview, stagedAISlide]);

  useEffect(() => {
    const ch = openLiveChannel();
    chRef.current = ch;
    if (!ch) return;
    ch.onmessage = (e) => {
      const msg = e.data as LiveMessage;
      if (msg.type === "ping") ch.postMessage({ type: "pong", slide: liveRef.current } as LiveMessage);
    };
    return () => { ch.close(); chRef.current = null; };
  }, []);

  const send = useCallback((slide: SlidePayload) => {
    setLive(slide);
    chRef.current?.postMessage({ type: "set", slide } as LiveMessage);
  }, []);

  const clearLive = useCallback(() => {
    setLive({ kind: "empty" });
    chRef.current?.postMessage({ type: "clear" } as LiveMessage);
  }, []);

  const goBlank = useCallback(() => send({ kind: "blank", bgColor: plan.blankBgColor }), [plan.blankBgColor, send]);
  const goLogo = useCallback(() => send({ kind: "logo", url: plan.logoUrl }), [plan.logoUrl, send]);

  const sendPreview = useCallback(() => send(previewSlide), [previewSlide, send]);

  const move = useCallback((dir: 1 | -1) => {
    setPreview((cur) => {
      const item = plan.items[cur.itemIdx];
      if (!item) return cur;
      let itemIdx = cur.itemIdx;
      let slideIdx = cur.slideIdx + dir;
      if (slideIdx < 0) {
        if (itemIdx === 0) return cur;
        itemIdx -= 1;
        slideIdx = plan.items[itemIdx].slides.length - 1;
      } else if (slideIdx >= item.slides.length) {
        if (itemIdx >= plan.items.length - 1) return cur;
        itemIdx += 1;
        slideIdx = 0;
      }
      const next = { itemIdx, slideIdx };
      if (autoSend) {
        const s = plan.items[next.itemIdx]?.slides[next.slideIdx];
        if (s) { setLive(s); chRef.current?.postMessage({ type: "set", slide: s } as LiveMessage); }
      }
      return next;
    });
  }, [plan.items, autoSend]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.key === " " || e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); move(-1); }
      else if (e.key === "Enter") { e.preventDefault(); sendPreview(); }
      else if (e.key === "b" || e.key === "B") { e.preventDefault(); goBlank(); }
      else if (e.key === "l" || e.key === "L") { e.preventDefault(); goLogo(); }
      else if (e.key === "Escape") { e.preventDefault(); clearLive(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, sendPreview, goBlank, goLogo, clearLive]);

  function jumpTo(itemIdx: number, slideIdx: number) {
    setPreview({ itemIdx, slideIdx });
    if (autoSend) {
      const s = plan.items[itemIdx]?.slides[slideIdx];
      if (s) send(s);
    }
  }

  function openOutputWindow(route: "/live" | "/stage" | "/livestream", name: string) {
    const w = Math.min(1920, Math.max(1280, window.screen.availWidth));
    const h = Math.round(w * 9 / 16);
    const win = window.open(
      route, name,
      `popup=1,noopener,noreferrer,width=${w},height=${h},menubar=no,toolbar=no,location=no,status=no`,
    );
    if (!win) window.open(route, "_blank");
  }
  function openProjector() { openOutputWindow("/live", "faithflow-live-window"); }
  function openStageDisplay() { openOutputWindow("/stage", "faithflow-stage-window"); }
  function openLivestream() { openOutputWindow("/livestream", "faithflow-livestream-window"); }

  // Bottom-tray safety helpers — mostly aliases to existing behaviour so the
  // new cockpit-style safety row is fully functional today. "Clear" variants
  // that don't have data yet (lower thirds, media overlays) fire toasts so
  // the button still gives feedback.
  const clearSlide = useCallback(() => { setStagedAISlide(null); setStagedSong(null); }, []);
  const clearMedia = useCallback(() => {
    setLive({ kind: "empty" });
    chRef.current?.postMessage({ type: "clear" } as LiveMessage);
  }, []);
  const clearLowerThird = useCallback(() => toast.info("Lower third cleared (placeholder)"), []);
  const stageMessage = useCallback(() => toast.info("Send-to-stage-message coming in Phase 2 stage-display wiring"), []);

  // --- AI approval: adds to bank + stages to Preview -----------------------
  // Approve pathway: adds to bank (which preloads ±5), stages to Preview.
  // Live is unaffected unless the operator hits SEND TO LIVE (or unless
  // auto-approve+auto-send mode is on, in which case the caller sends
  // directly — see autoApproveReact() below).
  const approveDetection = useCallback(async (d: Detection) => {
    try {
      const banked = await bankAdd({ book: d.book, chapter: d.chapter, verseStart: d.verseStart, verseEnd: d.verseEnd });
      if (!banked) throw new Error("Verse not found in library");
      setStagedAISlide(bankedToSlide(banked));
      dismissDetection(d.id);
      await updateDetectionStatus(d.id, "approved");
      toast.success(`${d.book} ${d.chapter}:${d.verseStart}${d.verseStart !== d.verseEnd ? `-${d.verseEnd}` : ""} staged`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Approve failed");
    }
  }, [bankAdd, bankedToSlide, dismissDetection]);

  // Recall a banked verse (operator scrolls history — "go back to what we
  // showed earlier"). Preview only.
  const recallBanked = useCallback((idx: number) => {
    const v = bankJumpTo(idx);
    if (v) setStagedAISlide(bankedToSlide(v));
  }, [bankJumpTo, bankedToSlide]);

  const rejectDetection = useCallback(async (d: Detection) => {
    dismissDetection(d.id);
    await updateDetectionStatus(d.id, "rejected").catch(() => { /* ignore */ });
  }, [dismissDetection]);

  // --- Auto-approve reaction ------------------------------------------------
  // When a fresh detection lands AND (a) auto-approve is on AND (b) the
  // detection's confidence >= the church's floor, we auto-run the approval
  // flow. If auto-send-to-Live is ALSO on, the approved verse skips
  // Preview and goes straight to Live via send(). Otherwise it stages to
  // Preview like a manual approve.
  //
  // ⚠️ This is an explicit opt-in feature (default off). It reverses the
  // original safety principle for churches that trust their operator +
  // context enough to hand it over.
  useEffect(() => {
    if (!autoApprove.enabled) return;
    if (audio.detections.length === 0) return;
    // Newest detection is at index 0 (per useAudioStream state append)
    const d = audio.detections[0];
    // Skip already-processed detections — this effect can re-fire when the
    // detections array shifts (dismiss shrinks it), and we don't want to
    // auto-approve stale entries retroactively.
    if (processedAutoApproved.current.has(d.id)) return;
    if (d.confidence < autoApprove.confidenceFloor) {
      console.log(`[autopilot] skipped: ${d.book} ${d.chapter}:${d.verseStart} confidence=${d.confidence} < floor=${autoApprove.confidenceFloor}`);
      return;
    }
    processedAutoApproved.current.add(d.id);
    console.log(`[autopilot] auto-approving: ${d.book} ${d.chapter}:${d.verseStart} confidence=${d.confidence} floor=${autoApprove.confidenceFloor} autoSend=${autoApprove.autoSendToLive}`);
    (async () => {
      try {
        const banked = await bankAdd({ book: d.book, chapter: d.chapter, verseStart: d.verseStart, verseEnd: d.verseEnd });
        if (!banked) return;
        const slide = bankedToSlide(banked);
        dismissDetection(d.id);
        await updateDetectionStatus(d.id, "approved").catch(() => { /* ignore */ });
        const refLabel = `${d.book} ${d.chapter}:${d.verseStart}${d.verseStart !== d.verseEnd ? `-${d.verseEnd}` : ""}`;
        setAutopilotActivity({ source: "auto-approve", ref: refLabel, ts: Date.now() });
        if (autoApprove.autoSendToLive) {
          // Bypass Preview → go straight to Live via the standard send() path
          setLive(slide);
          chRef.current?.postMessage({ type: "set", slide } as LiveMessage);
          toast.info(`Autopilot → LIVE · ${refLabel}`, { duration: 2000 });
        } else {
          setStagedAISlide(slide);
          toast.info(`Autopilot → PREVIEW · ${refLabel}`, { duration: 2000 });
        }
      } catch (e) {
        console.error("[autopilot] failed:", e instanceof Error ? e.message : String(e));
      }
    })();
  // We deliberately depend only on the newest detection id to keep this
  // firing once per detection.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio.detections[0]?.id]);

  // --- Wake-word-free contextual commands ----------------------------------
  // Handles both verse verbs (next verse / continue / back) AND slide verbs
  // (next slide / previous slide / blank / clear the screen). Fires on every
  // finalized transcript segment. Each verb only counts when the required
  // context is present — a bare "next slide" ignores unless a slide is up.
  useEffect(() => {
    const last = audio.transcript[audio.transcript.length - 1];
    if (!last || !last.final) return;
    if (processedSegments.current.has(last.id)) return;
    processedSegments.current.add(last.id);
    const hasVerseContext = currentBankRef !== null;
    const hasSlideContext = live.kind !== "empty" || previewSlide.kind !== "empty";
    const hasSongContext = stagedSong !== null;
    const cmd = parseContextCommand(last.text, { hasVerseContext, hasSlideContext, hasSongContext });
    if (!cmd) return;
    (async () => {
      // Verse commands go through the bank + auto-send config
      if (cmd.verb === "next_verse" || cmd.verb === "prev_verse" || cmd.verb === "continue" || cmd.verb === "back") {
        const mode = cmd.verb === "next_verse" ? "next"
          : cmd.verb === "prev_verse" ? "prev"
          : cmd.verb === "continue" ? "continue"
          : "back";
        const next = await bankAdvance(mode);
        if (!next) return;
        const slide = bankedToSlide(next);
        const refLabel = `${next.book} ${next.chapter}:${next.verseStart}${next.verseStart !== next.verseEnd ? `-${next.verseEnd}` : ""}`;
        setAutopilotActivity({ source: "context-verse", ref: refLabel, ts: Date.now() });
        if (autoApprove.enabled && autoApprove.autoSendToLive) {
          setLive(slide);
          chRef.current?.postMessage({ type: "set", slide } as LiveMessage);
        } else {
          setStagedAISlide(slide);
        }
        toast.success(`${cmd.verb.replace("_", " ")} → ${refLabel}`);
        return;
      }
      // Slide navigation — same safety principle as verse advance:
      // preview stages by default, autopilot+auto-send goes live.
      if (cmd.verb === "next_slide") {
        move(1);
        setAutopilotActivity({ source: "context-slide", ref: "Next slide", ts: Date.now() });
        if (autoApprove.enabled && autoApprove.autoSendToLive) {
          setTimeout(() => send(previewSlide), 0);
        }
        toast.info("Next slide");
        return;
      }
      if (cmd.verb === "prev_slide") {
        move(-1);
        setAutopilotActivity({ source: "context-slide", ref: "Previous slide", ts: Date.now() });
        if (autoApprove.enabled && autoApprove.autoSendToLive) {
          setTimeout(() => send(previewSlide), 0);
        }
        toast.info("Previous slide");
        return;
      }
      // Screen commands — always operator-destructive; behave like the
      // BLANK / CLEAR buttons themselves. Do NOT auto-send anything else.
      if (cmd.verb === "blank_screen") { goBlank(); toast.info("Screen blanked"); return; }
      if (cmd.verb === "clear_screen") { clearLive(); toast.info("Screen cleared"); return; }

      // --- Phase 5 dangerous verbs — ALWAYS approval-gated regardless of mode ---
      if (cmd.verb === "start_countdown") {
        const seconds = Number((cmd.payload as { seconds?: number } | undefined)?.seconds) || 300;
        toast(`Voice: start countdown ${seconds}s?`, {
          action: { label: "Approve", onClick: () => {
            const target = Date.now() + seconds * 1000;
            setCountdownEndsAt(target);
            toast.success(`Countdown started (${seconds}s)`);
          }},
        });
        return;
      }
      if (cmd.verb === "captions_on") {
        toast("Voice: turn captions on?", {
          action: { label: "Approve", onClick: () => toast.info("Captions on (placeholder — full captions land later)") },
        });
        return;
      }
      if (cmd.verb === "captions_off") {
        toast("Voice: turn captions off?", {
          action: { label: "Approve", onClick: () => toast.info("Captions off (placeholder)") },
        });
        return;
      }
      if (cmd.verb === "show_chorus") {
        toast("Voice: jump to chorus?", {
          action: { label: "Approve", onClick: () => {
            if (!stagedSong) { toast.info("No song staged"); return; }
            const idx = stagedSong.slides.findIndex((s) => s.kind === "text" && /^\s*(chorus|refrain)\b/i.test((s as { text: string }).text));
            if (idx < 0) { toast.info("No chorus slide found in current song"); return; }
            setStagedAISlide(stagedSong.slides[idx]);
            setStagedSong({ ...stagedSong, currentIdx: idx });
            toast.success("Jumped to chorus");
          }},
        });
        return;
      }
      if (cmd.verb === "goto_verse") {
        const n = Number((cmd.payload as { index?: number } | undefined)?.index);
        if (!Number.isFinite(n) || n < 1) return;
        toast(`Voice: go to verse ${n}?`, {
          action: { label: "Approve", onClick: () => {
            if (!stagedSong) { toast.info("No song staged"); return; }
            const re = new RegExp(`^\\s*verse\\s*${n}\\b`, "i");
            let idx = stagedSong.slides.findIndex((s) => s.kind === "text" && re.test((s as { text: string }).text));
            if (idx < 0) {
              // Fall back: assume slide index N-1 within the song
              if (n - 1 < stagedSong.slides.length) idx = n - 1;
            }
            if (idx < 0) { toast.info(`Verse ${n} not found`); return; }
            setStagedAISlide(stagedSong.slides[idx]);
            setStagedSong({ ...stagedSong, currentIdx: idx });
            toast.success(`Jumped to verse ${n}`);
          }},
        });
        return;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio.transcript.length]);

  // ---- Song approvals: identical safety pattern -------------------------
  const approveSong = useCallback(async (s: SongSuggestion) => {
    try {
      if (!s.songId) throw new Error("Song not in library");
      const res = await fetch(`/api/songs/${s.songId}/slides`).then((r) => r.json());
      if (res.error) throw new Error(res.error);
      const slides: SlidePayload[] = (res.slides || []).map((x: { lyrics: string }) => ({ kind: "text" as const, text: x.lyrics }));
      if (slides.length === 0) throw new Error("Song has no slides");
      // ⚠️ SAFETY: stage first slide to Preview. Never call send().
      setStagedAISlide(slides[0]);
      setStagedSong({ slides, currentIdx: 0 });
      dismissSong(s.suggestionId);
      await updateAiSuggestionStatus(s.suggestionId, "approved", { actionTaken: "manual_approved" }); bumpHistory();
      toast.success(`"${s.title}" staged to Preview`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Approve failed");
    }
  }, [dismissSong]);

  const rejectSong = useCallback(async (s: SongSuggestion) => {
    dismissSong(s.suggestionId);
    await updateAiSuggestionStatus(s.suggestionId, "rejected").catch(() => { /* ignore */ }); bumpHistory();
  }, [dismissSong]);

  // ---- Voice command approvals ------------------------------------------
  // For "next/prev slide" and "show *" commands the approval mimics existing
  // preview-only gestures. For "blank / logo / clear" the approval mimics
  // the operator clicking the equivalent Live button — that's the same
  // "explicit operator action" the safety principle allows.
  const approveCommand = useCallback(async (c: CommandSuggestion) => {
    try {
      dismissCommand(c.suggestionId);
      await updateAiSuggestionStatus(c.suggestionId, "approved", { actionTaken: "manual_approved" }).catch(() => { /* ignore */ }); bumpHistory();
      switch (c.verb) {
        case "next_slide": move(1); break;
        case "prev_slide": move(-1); break;
        case "blank": goBlank(); break;
        case "logo": goLogo(); break;
        case "clear_live": clearLive(); break;
        case "show_reference": {
          // Free-text query: try Bible reference parser first; if it fails,
          // silently no-op with a toast asking the operator to be more
          // specific (never guess into Preview).
          const q = String(c.payload.query || "").trim();
          if (!q) { toast.info("Nothing to show"); break; }
          // Reuse the Bible parser and the existing lookup endpoint.
          const parsed = await import("@/lib/bible-parser").then((m) => m.parseReferences(q));
          if (parsed.length === 0) { toast.info(`Couldn't parse "${q}"`); break; }
          const ref = parsed[0];
          const res = await fetch("/api/bible/lookup", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ book: ref.book, chapter: ref.chapter, verseStart: ref.verseStart, verseEnd: ref.verseEnd, translationCode: defaultTranslationCode }),
          }).then((r) => r.json());
          if (res.error) throw new Error(res.error);
          const text = (res.verses || []).map((v: { text: string }) => v.text).join(" ");
          const label = `${ref.book} ${ref.chapter}:${ref.verseStart}${ref.verseStart !== ref.verseEnd ? `-${ref.verseEnd}` : ""} (${res.translation})`;
          setStagedAISlide({ kind: "text", text: `${text}\n\n${label}` });
          toast.success(`${label} staged to Preview`);
          break;
        }
        case "show_song": toast.info("Say the song title after the wake prefix, e.g. 'faithflow show amazing grace'"); break;
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Command failed");
    }
  }, [dismissCommand, move, goBlank, goLogo, clearLive, defaultTranslationCode]);

  const rejectCommand = useCallback(async (c: CommandSuggestion) => {
    dismissCommand(c.suggestionId);
    await updateAiSuggestionStatus(c.suggestionId, "rejected").catch(() => { /* ignore */ }); bumpHistory();
  }, [dismissCommand]);

  const clearStagedAI = useCallback(() => setStagedAISlide(null), []);

  // --- Edit action: opens modal for song / command suggestions -----------
  const editSong = useCallback((s: SongSuggestion) => {
    setEditing({ suggestionId: s.suggestionId, type: "song", payload: { title: s.title } });
  }, []);
  const editCommand = useCallback((c: CommandSuggestion) => {
    setEditing({ suggestionId: c.suggestionId, type: "action", payload: { verb: c.verb, ...(c.payload || {}) } });
  }, []);
  const onSuggestionEdited = useCallback(() => {
    bumpHistory();
    // The state-machine's "edited" transition ends in "edited" state; the
    // operator still needs to explicitly stage/send. We just refresh history
    // so the pencil timeline entry appears immediately.
    const t = transition("detected", { kind: "manual_edit" }, {
      autoApproveEnabled: autoApprove.enabled,
      autoApproveThreshold: autoApprove.confidenceFloor,
      autoSendToLive: autoApprove.autoSendToLive,
    });
    console.log("[autopilot]", t.reason);
  }, [bumpHistory, autoApprove.enabled, autoApprove.confidenceFloor, autoApprove.autoSendToLive]);

  // Labels driving the OutputStack headers
  const previewItemLabel = plan.items[preview.itemIdx]?.title || "";
  const previewSlideInfo = plan.items[preview.itemIdx]
    ? `Item ${preview.itemIdx + 1}/${plan.items.length} · Slide ${preview.slideIdx + 1}/${plan.items[preview.itemIdx].slides.length}`
    : "";
  const liveItemIdx = plan.items.findIndex((it) => it.slides.some((s) => JSON.stringify(s) === JSON.stringify(live)));

  return (
    <div className="h-screen flex flex-col" style={{ background: "var(--color-app-bg)", color: "var(--color-foreground)" }}>
      {/* Top bar */}
      <div className="h-14 border-b flex items-center justify-between px-4 shrink-0"
        style={{ borderColor: "var(--color-border)", background: "var(--color-panel)" }}>
        <div className="flex items-center gap-3">
          <Link href={`/services/${plan.id}`} className="text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="eyebrow">Operator</div>
            <div className="text-sm font-semibold">{plan.title}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {autoApprove.enabled && (
            <span
              title={autoApprove.autoSendToLive
                ? `AUTOPILOT: high-confidence detections auto-approve AND auto-send to Live (floor ${autoApprove.confidenceFloor}%). Manual controls remain functional.`
                : `AUTOPILOT: high-confidence detections auto-stage to Preview (floor ${autoApprove.confidenceFloor}%). You still hit SEND TO LIVE.`}
              className={cn(
                "inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[10px] font-bold uppercase tracking-wider border transition-colors",
                autoApprove.autoSendToLive
                  ? "border-destructive text-destructive bg-destructive/10 animate-pulse"
                  : "border-warning text-warning bg-warning/10",
              )}>
              <Zap className="w-3 h-3" />
              Autopilot{autoApprove.autoSendToLive ? " → Live" : " → Preview"}
              <span className="opacity-70 font-mono normal-case">{autoApprove.confidenceFloor}%</span>
            </span>
          )}
          <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
            <input type="checkbox" checked={autoSend} onChange={(e) => setAutoSend(e.target.checked)} />
            Auto-send on next
          </label>
          <EndServiceButton planId={plan.id} hasTranscript={audio.transcript.length > 0} />
          <AutopilotModePicker mode={autopilotMode} onChange={setAutopilotMode} />
          <ListeningToggle listening={audio.listening} onToggle={() => audio.listening ? stopAudio() : startAudio()} />
          <button onClick={openProjector}
            className="inline-flex items-center gap-1.5 h-8 px-3 border border-border rounded-md text-xs font-semibold hover:bg-accent">
            <Monitor className="w-3.5 h-3.5" /> Open projector window
          </button>
          <button onClick={() => setAiPanelOpen((v) => !v)}
            title={aiPanelOpen ? "Hide AI Assistant" : "Show AI Assistant"}
            className="inline-flex items-center justify-center h-8 w-8 border border-border rounded-md text-muted-foreground hover:bg-accent">
            {aiPanelOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Autopilot banner (Phase 5) — visible when armed or active. Sits
         directly above the workspace so it visually caps the Preview column. */}
      {(autopilotMode === "armed" || autopilotMode === "active") && (
        <div
          className={cn(
            "px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider flex items-center justify-center gap-2 border-b",
            autopilotMode === "active"
              ? "bg-destructive/10 text-destructive border-destructive/40 animate-pulse"
              : "bg-warning/10 text-warning border-warning/40"
          )}
        >
          <Zap className="w-3 h-3" />
          {autopilotMode === "active"
            ? "Autopilot Active — auto-staging high-confidence scripture"
            : "Autopilot Armed — next high-confidence detection will auto-stage when moved to Active"}
        </div>
      )}

      {/* Main cockpit: 3 columns × 2 rows.
         Row 1: Rail | Workspace | OutputStack + AI panel
         Row 2 (full-width): Bottom safety tray */}
      <div className="flex-1 flex min-h-0">
        <ProductionRail
          items={plan.items}
          activeItemIdx={preview.itemIdx}
          liveItemIdx={liveItemIdx >= 0 ? liveItemIdx : null}
          activeSection={railSection}
          onActiveChange={setRailSection}
          onJump={(i) => jumpTo(i, 0)}
        />

        <WorkspaceTabs
          mode={workspaceMode}
          onModeChange={setWorkspaceMode}
          items={plan.items}
          activeItemIdx={preview.itemIdx}
          activeSlideIdx={preview.slideIdx}
          onJumpSlide={jumpTo}
          previewSlide={previewSlide}
          onSendPreviewSlide={(s) => setStagedAISlide(s)}
          onSendLiveSlide={(s) => send(s)}
          defaultTranslationCode={defaultTranslationCode}
          listening={audio.listening}
          transcriptText={audio.transcript.slice(-8).map((t) => t.text).join(" ") + " " + audio.interim}
          autopilotActive={autopilotMode === "active"}
        />

        <OutputStack
          previewSlide={previewSlide}
          liveSlide={live}
          previewLabel={previewItemLabel}
          liveLabel={liveItemIdx >= 0 ? plan.items[liveItemIdx].title : ""}
          previewSlideInfo={previewSlideInfo}
          liveSlideInfo=""
          aspectRatio={aspectRatio}
          fitMode={fitMode}
          safeArea={safeArea}
          onAspectChange={setAspectRatio}
          onFitChange={setFitMode}
          onSafeAreaToggle={() => setSafeArea((v) => !v)}
          onOpenProjector={openProjector}
          onOpenStage={openStageDisplay}
          onOpenStream={openLivestream}
          liveIsLive={live.kind !== "empty"}
        />

        {aiPanelOpen && (
          <AIAssistantPanel
            audio={audio}
            onApprove={approveDetection}
            onReject={rejectDetection}
            onApproveSong={approveSong}
            onRejectSong={rejectSong}
            onApproveCommand={approveCommand}
            onRejectCommand={rejectCommand}
            confidenceThreshold={confidenceThreshold}
            bank={bank}
            currentBankIdx={bank.findIndex((b) => currentBankRef && b.id === currentBankRef.id)}
            onRecall={recallBanked}
            autoApproveOn={autoApprove.enabled}
            onEditSong={editSong}
            onEditCommand={editCommand}
          />
        )}
      </div>
      <div className="shrink-0 border-t" style={{ borderColor: "var(--color-border)" }}>
        <SuggestionHistory planId={plan.id} refreshKey={historyKey} />
      </div>
      <EditSuggestionModal
        open={editing !== null}
        suggestion={editing}
        onClose={() => setEditing(null)}
        onSaved={onSuggestionEdited}
      />

      <BottomTray
        activeItem={plan.items[preview.itemIdx]}
        activeSlideIdx={preview.slideIdx}
        onJumpSlide={(s) => jumpTo(preview.itemIdx, s)}
        onSendPreview={sendPreview}
        onBlank={goBlank}
        onLogo={goLogo}
        onKill={clearLive}
        onClearSlide={clearSlide}
        onClearMedia={clearMedia}
        onClearLowerThird={clearLowerThird}
        onStageMessage={stageMessage}
        autopilotOn={autoApprove.enabled}
      />
    </div>
  );
}

function AutopilotModePicker({ mode, onChange }: { mode: AutopilotMode; onChange: (m: AutopilotMode) => void }) {
  const items: { key: AutopilotMode; label: string; title: string }[] = [
    { key: "manual",     label: "Manual",     title: "No AI listening, no suggestions" },
    { key: "suggestion", label: "Suggestion", title: "AI listens; every action requires operator approval" },
    { key: "armed",      label: "Armed",      title: "Autopilot primed but not firing — approval still required" },
    { key: "active",     label: "Active",     title: "High-confidence scripture detections auto-approve" },
  ];
  return (
    <div className="inline-flex items-center rounded-md border border-border overflow-hidden text-[10px] font-bold uppercase tracking-wider h-8">
      {items.map((it) => {
        const on = it.key === mode;
        const danger = it.key === "active";
        const warn = it.key === "armed";
        return (
          <button
            key={it.key}
            title={it.title}
            onClick={() => onChange(it.key)}
            className={cn(
              "px-2.5 h-full border-r border-border last:border-r-0 transition-colors",
              on && danger && "bg-destructive text-destructive-foreground",
              on && warn && "bg-warning/20 text-warning",
              on && !danger && !warn && "bg-foreground text-background",
              !on && "text-muted-foreground hover:bg-accent",
            )}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

function PlaylistRow({ item, idx, preview, onJump }: { item: ExpandedItem; idx: number; preview: Cursor; onJump: (i: number, s: number) => void }) {
  const active = preview.itemIdx === idx;
  return (
    <button onClick={() => onJump(idx, 0)}
      className={cn(
        "w-full text-left px-3 py-2 rounded-md text-sm transition-all border",
        active ? "bg-foreground text-background border-foreground" : "border-transparent hover:bg-accent"
      )}>
      <div className="flex items-center gap-2">
        <span className={cn("text-[10px] font-mono uppercase tracking-wider", active ? "text-background/70" : "text-muted-foreground")}>
          {item.type}
        </span>
        <span className="ml-auto text-[10px] opacity-60">{item.slides.length}</span>
      </div>
      <div className="font-medium truncate">{item.title}</div>
    </button>
  );
}
