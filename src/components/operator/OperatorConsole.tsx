"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ChevronLeft, ChevronRight, Monitor, Radio, Square, Sun, PanelRightClose, PanelRightOpen } from "lucide-react";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import { openLiveChannel, safePost, isValidMessageOverlay, type SlidePayload, type LiveMessage, type OutputState, type MessageOverlay } from "@/lib/broadcast";
import { openOutputChannel } from "@/lib/realtime";
import { SyncControl } from "./SyncControl";
import type { ExpandedPlan, ExpandedItem } from "@/lib/server/services";
import { cn } from "@/lib/utils";
import { useAudioStream, type Detection, type SongSuggestion, type CommandSuggestion, type UnifiedSuggestion } from "./useAudioStream";
import type { IndexedSong } from "@/lib/ai-detection/lyric-fragment";
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
import { TimersShell, LowerThirdsShell, StageDisplayShell, LivestreamShell, ImportsShell, ArchiveShell, SettingsShell, SHELL_SECTIONS, railSectionToWorkspaceMode } from "./RailWorkspaceShells";
import { ImportSongModal } from "./ImportSongModal";
import type { InternetMetadataCard } from "./AIAssistantPanel";
import { OutputStack } from "./OutputStack";
import { BottomTray } from "./BottomTray";
import { EndServiceButton } from "./EndServiceButton";
import { OperatorShell } from "./OperatorShell";
import { ProOperatorShell } from "./pro/ProOperatorShell";
import type { OperatorShellCtx } from "./shell/types";
import { useShell } from "@/hooks/useShell";

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

const AUTOPILOT_MODE_KEY = "presentflow.autopilot.mode";

export function OperatorConsole({ plan: planProp, defaultTranslationCode: initialTranslationCode, confidenceThreshold, autoApprove: autoApproveProp, initialShell }: {
  plan: ExpandedPlan;
  defaultTranslationCode: string;
  confidenceThreshold: number;
  autoApprove: AutoApproveConfig;
  initialShell?: "desktop" | "web";
}) {
  const router = useRouter();
  // Voice command "give me NIV" (and future variants) can override the
  // active translation without reloading. Seeded from the server-provided
  // prop; listener below responds to `presentflow:switch-translation`.
  const [defaultTranslationCode, setDefaultTranslationCode] = useState(initialTranslationCode);
  useEffect(() => { setDefaultTranslationCode(initialTranslationCode); }, [initialTranslationCode]);
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ code?: string }>).detail;
      const code = detail?.code?.toUpperCase();
      if (!code || !/^[A-Z0-9]{2,10}$/.test(code)) return;
      setDefaultTranslationCode(code);
    };
    window.addEventListener("presentflow:switch-translation", handler);
    return () => window.removeEventListener("presentflow:switch-translation", handler);
  }, []);
  // R2: optimistic plan state. Seeded from server-rendered `planProp` and
  // updated when the prop changes (i.e. after `router.refresh()`). Local
  // append lets the operator UI reflect a library add immediately without
  // waiting for the round-trip, so we can drop the old `window.location.reload()`
  // which nuked interim transcript state, the audio pipeline, and
  // BroadcastChannel output state (CLAUDE.md rule 8).
  const [plan, setPlan] = useState<ExpandedPlan>(planProp);
  useEffect(() => { setPlan(planProp); }, [planProp]);
  // --- Four-mode autopilot (Phase 5) ---------------------------------------
  // On page load we ALWAYS downgrade "active" to "armed" as a safety
  // measure — the operator must consciously re-arm live-firing every session.
  // Always init deterministically for SSR + first client render; hydrate from
  // localStorage post-mount to avoid hydration mismatch.
  const [autopilotMode, setAutopilotModeInner] = useState<AutopilotMode>(
    autoApproveProp.enabled ? "armed" : "suggestion"
  );
  useEffect(() => {
    try {
      // #4: honor the simplified auto-approve toggle first — it's the
      // primary switch operators interact with. If the toggle key is set
      // it wins over the legacy autopilot mode key.
      const autoRaw = window.localStorage.getItem("presentflow.pro.autoApprove.v1");
      if (autoRaw === "1") { setAutopilotModeInner("active"); return; }
      if (autoRaw === "0") { setAutopilotModeInner("suggestion"); return; }
      const raw = window.localStorage.getItem(AUTOPILOT_MODE_KEY);
      if (raw === "manual" || raw === "suggestion" || raw === "armed" || raw === "active") {
        setAutopilotModeInner(raw);
      }
    } catch { /* noop */ }
  }, []);
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
  const shell = useShell(initialShell);
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
  const [railSection, setRailSectionInner] = useState<RailSection>("service");
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("flow");
  const [internetMatches, setInternetMatches] = useState<InternetMetadataCard[]>([]);
  const [importModal, setImportModal] = useState<{ title: string; artist?: string } | null>(null);
  const setRailSection = useCallback((s: RailSection) => {
    setRailSectionInner(s);
    const mapped = railSectionToWorkspaceMode(s);
    if (mapped) setWorkspaceMode(mapped);
  }, []);
  const internetLookupFiredRef = useRef<Set<string>>(new Set());
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "4:3" | "custom">("16:9");
  const [fitMode, setFitMode] = useState<"contain" | "fill" | "crop">("contain");
  const [safeArea, setSafeArea] = useState(false);
  // Phase 5D-2: projector-level layers
  const [announcement, setAnnouncement] = useState<import("@/lib/broadcast").AnnouncementPayload | null>(null);
  const [transitionSpec, setTransitionSpec] = useState<import("@/lib/broadcast").TransitionSpec | null>(null);

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
  // Y2: skip emission when the packed OutputState hasn't actually changed
  // (previously fired on every parent re-render).
  // R1: compute nextItem for Stage NEXT header (playlist item name + type).
  const nextItemForStage = (() => {
    const curItem = plan.items[preview.itemIdx];
    if (!curItem) return null;
    if (preview.slideIdx + 1 < curItem.slides.length) {
      return { title: curItem.title, type: (curItem as unknown as { type?: string }).type ?? "item" };
    }
    const ni = plan.items[preview.itemIdx + 1];
    return ni ? { title: ni.title, type: (ni as unknown as { type?: string }).type ?? "item" } : null;
  })();
  const lastEmittedKeyRef = useRef<string>("");
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
      announcement,
      transition: transitionSpec,
      nextItem: nextItemForStage,
    };
    // Shallow signature — good enough for the fields we actually emit.
    let key: string;
    try { key = JSON.stringify(state); } catch { key = String(Math.random()); }
    if (key === lastEmittedKeyRef.current) return;
    lastEmittedKeyRef.current = key;
    lastOutputStateRef.current = state; // cached for snapshot-on-join replay
    safePost(chRef.current, { type: "output", state });
    if (rtRef.current) { void rtRef.current.publish(state); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, preview.itemIdx, preview.slideIdx, aspectRatio, fitMode, safeArea, plan.items, countdownEndsAt, announcement, transitionSpec]);
  const chRef = useRef<BroadcastChannel | null>(null);
  const liveRef = useRef<SlidePayload>(live);
  liveRef.current = live;

  // Networked projector sync: when a pair code is minted the operator's
  // OutputState is ALSO published on the Supabase Realtime channel scoped by
  // that code. BroadcastChannel (same-machine) remains the primary low-latency
  // path — this is strictly additive fan-out.
  const rtRef = useRef<ReturnType<typeof openOutputChannel> | null>(null);
  const lastOutputStateRef = useRef<OutputState | null>(null);
  const [pairCode, setPairCode] = useState<string | null>(null);
  const churchIdForChannel = (plan as unknown as { churchId?: string }).churchId ?? "";
  useEffect(() => {
    if (rtRef.current) { try { rtRef.current.close(); } catch { /* ignore */ } rtRef.current = null; }
    if (pairCode) {
      // Y8: church-scoped channel prevents cross-tenant leakage when two
      // churches happen to mint the same 6-char code.
      rtRef.current = openOutputChannel(pairCode, churchIdForChannel);
      rtRef.current.subscribe(() => { /* publisher only */ });
      // Snapshot provider: when a late/reconnecting projector joins the
      // channel it fires snapshot_request; we replay the last OutputState
      // so it catches up immediately instead of staring at black.
      rtRef.current.onRequestSnapshot(() => lastOutputStateRef.current);
    }
    return () => {
      if (rtRef.current) { try { rtRef.current.close(); } catch { /* ignore */ } rtRef.current = null; }
    };
  }, [pairCode, churchIdForChannel]);
  const publishRealtime = useCallback((state: OutputState) => {
    if (!rtRef.current) return;
    void rtRef.current.publish(state);
  }, []);

  // Phase 5A: local song library for client-side lyric/title matching.
  // Fetched once on mount; refreshed via manual reload (song imports).
  const [songLibrary, setSongLibrary] = useState<IndexedSong[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/songs/library").then((r) => r.json()).then((res) => {
      if (cancelled) return;
      if (Array.isArray(res.songs)) setSongLibrary(res.songs as IndexedSong[]);
    }).catch(() => { /* non-fatal */ });
    return () => { cancelled = true; };
  }, []);

  // Playlist song IDs — for the "in-playlist" confidence boost.
  const planSongIds = useMemo(() => plan.items.map((it) => (it as unknown as { songId?: string }).songId).filter(Boolean) as string[], [plan.items]);

  const getDetectContext = useCallback(() => ({
    churchId: (plan as unknown as { churchId?: string }).churchId || "",
    planId: plan.id,
    planSongIds,
    recentSongIds: [] as string[],
    hasVerseContext: false,
    hasSlideContext: true, // always assume some slide context in operator
    hasSongContext: false, // updated below via ref
  }), [plan.id, planSongIds, plan]);

  const { state: audio, start: startAudio, stop: stopAudio, resume: resumeAudio, restart: restartAudio, warmStart: warmStartAudio, dismissDetection, dismissSong, dismissCommand, dismissSuggestion, simulateTranscript } = useAudioStream(plan.id, {
    library: songLibrary,
    getDetectContext,
  });

  // In "manual" mode we force the audio stream off — no suggestions at all.
  useEffect(() => {
    if (autopilotMode === "manual" && audio.listening) stopAudio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autopilotMode, audio.listening]);

  // Verse bank: per-service history of approved refs + ±5 preload window
  const { bank, currentRef: currentBankRef, addReference: bankAdd, advanceOne: bankAdvance, jumpTo: bankJumpTo, clear: bankClear, bankedToSlide } = useVerseBank(defaultTranslationCode);
  // Bible-panel handlers (Bible redesign)
  const [hiddenBankIds, setHiddenBankIds] = useState<Set<string>>(new Set());
  const effectiveBank = useMemo(() => bank.filter((b) => !hiddenBankIds.has(b.id)), [bank, hiddenBankIds]);
  const sendSlideToLive = useCallback((slide: SlidePayload, spec?: import("@/lib/broadcast").TransitionSpec | null) => {
    if (spec !== undefined) setTransitionSpec(spec);
    setLive(slide);
    chRef.current?.postMessage({ type: "set", slide } as LiveMessage);
  }, []);
  const stageSlide = useCallback((slide: SlidePayload) => setStagedAISlide(slide), []);
  const sendBankedToLive = useCallback((idx: number) => {
    const v = effectiveBank[idx];
    if (!v) return;
    const slide = bankedToSlide(v);
    setLive(slide);
    chRef.current?.postMessage({ type: "set", slide } as LiveMessage);
  }, [effectiveBank, bankedToSlide]);
  const removeBanked = useCallback((idx: number) => {
    const v = effectiveBank[idx];
    if (!v) return;
    setHiddenBankIds((cur) => { const n = new Set(cur); n.add(v.id); return n; });
  }, [effectiveBank]);
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
    // Priority 4 / Y4: the desktop shell uses the centralized
    // useOperatorHotkeys hook mounted in ProOperatorShell. Only run this
    // legacy handler when we're DEFINITELY on the web shell — a positive
    // check protects against SSR flash / test harness where `shell` might
    // be undefined and both handlers would otherwise fire.
    if (shell !== "web") return;
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
  }, [move, sendPreview, goBlank, goLogo, clearLive, shell]);

  function jumpTo(itemIdx: number, slideIdx: number) {
    setPreview({ itemIdx, slideIdx });
    if (autoSend) {
      const s = plan.items[itemIdx]?.slides[slideIdx];
      if (s) send(s);
    }
  }

  function openOutputWindow(route: "/live" | "/stage" | "/livestream", name: string) {
    // In the Electron desktop shell, route through IPC so the output opens
    // fullscreen on the assigned secondary display instead of a browser popup.
    if (typeof window !== "undefined" && window.electronAPI) {
      const role = route === "/live" ? "Projector" : route === "/stage" ? "Stage" : "Livestream";
      void window.electronAPI.screens.spawn(role);
      return;
    }
    const w = Math.min(1920, Math.max(1280, window.screen.availWidth));
    const h = Math.round(w * 9 / 16);
    const win = window.open(
      route, name,
      `popup=1,noopener,noreferrer,width=${w},height=${h},menubar=no,toolbar=no,location=no,status=no`,
    );
    if (!win) window.open(route, "_blank");
  }
  function openProjector() { openOutputWindow("/live", "presentflow-live-window"); }
  function openStageDisplay() { openOutputWindow("/stage", "presentflow-stage-window"); }
  function openLivestream() { openOutputWindow("/livestream", "presentflow-livestream-window"); }

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
          // Snapshot the previous live slide so the toast can offer a one-tap
          // undo. Autopilot mistakes on Sunday morning are otherwise permanent
          // until the operator manually clicks a replacement.
          const prevLive = live;
          console.log("[auto-approve] firing:", refLabel, d.confidence);
          setLive(slide);
          chRef.current?.postMessage({ type: "set", slide } as LiveMessage);
          toast.info(`Autopilot → LIVE · ${refLabel}`, {
            duration: 4000,
            action: {
              label: "Undo",
              onClick: () => {
                setLive(prevLive);
                chRef.current?.postMessage({ type: "set", slide: prevLive } as LiveMessage);
                toast.success("Reverted");
              },
            },
          });
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
        case "show_song": toast.info("Say the song title after the wake prefix, e.g. 'presentflow show amazing grace'"); break;
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

  // -------- Unified suggestion handlers (Phase 5A) --------------------------
  const previewUnified = useCallback((s: UnifiedSuggestion) => {
    if (s.type === "song" || s.type === "lyric") {
      const p = s.match.previewPayload;
      if (p.kind !== "text" || !p.text?.trim()) { toast.info("No local/licensed match to preview"); return; }
      setStagedAISlide(p);
      dismissSuggestion(s.id);
      toast.success(`Staged "${s.match.title}" to Preview`);
    } else if (s.type === "section") {
      if (!stagedSong) { toast.info("No song staged"); return; }
      const re = s.section === "chorus" ? /^\s*(chorus|refrain)\b/i
        : s.section === "verse" ? new RegExp(`^\\s*verse\\s*${s.index ?? ""}\\b`, "i")
        : s.section === "bridge" ? /^\s*bridge\b/i
        : s.section === "outro" ? /^\s*(outro|ending)\b/i
        : /^\s*tag\b/i;
      const idx = stagedSong.slides.findIndex((sl) => sl.kind === "text" && re.test((sl as { text: string }).text));
      if (idx < 0) { toast.info(`${s.section} not found`); return; }
      setStagedAISlide(stagedSong.slides[idx]);
      setStagedSong({ ...stagedSong, currentIdx: idx });
      dismissSuggestion(s.id);
      toast.success(`Jumped to ${s.section}`);
    }
  }, [dismissSuggestion, stagedSong]);

  const sendLiveUnified = useCallback((s: UnifiedSuggestion) => {
    // SAFETY: song/lyric content is NEVER auto-live, but an explicit operator
    // click is an explicit operator action — same principle as sidebar buttons.
    if (s.type === "song" || s.type === "lyric") {
      const p = s.match.previewPayload;
      if (p.kind !== "text" || !p.text?.trim()) { toast.info("No local/licensed match — cannot send"); return; }
      send(p);
      dismissSuggestion(s.id);
      toast.success(`Sent "${s.match.title}" to Live`);
    }
  }, [dismissSuggestion, send]);

  const queueUnified = useCallback((s: UnifiedSuggestion) => {
    if (s.type === "song" || s.type === "lyric") {
      toast.info(`Queued "${s.match.title}" (added to bank)`);
      dismissSuggestion(s.id);
    }
  }, [dismissSuggestion]);

  const rejectUnified = useCallback((s: UnifiedSuggestion) => dismissSuggestion(s.id), [dismissSuggestion]);

  const importSong = useCallback((title: string) => {
    toast.info(`Open library to import "${title}"`);
  }, []);

  // Auto-accept for unified lyric/song suggestions (Phase 5A rules).
  // Below 60% → hidden by the card itself
  // 60-89% → require manual
  // 90-94% + Autopilot ACTIVE → auto-stage to Preview (treat active as Auto-Preview)
  // 95%+ + Autopilot ACTIVE → still stage to Preview only (never Live for song content, copyright safety)
  const autoAcceptedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!autoApprove.enabled) return;
    for (const s of audio.suggestions) {
      if (s.type !== "song" && s.type !== "lyric") continue;
      if (autoAcceptedRef.current.has(s.id)) continue;
      if (s.confidence < 90) continue;
      autoAcceptedRef.current.add(s.id);
      const p = s.match.previewPayload;
      if (p.kind !== "text" || !p.text?.trim()) continue;
      setStagedAISlide(p);
      setAutopilotActivity({ source: "auto-approve", ref: s.match.title, ts: Date.now() });
      toast.info(`Autopilot → PREVIEW · ${s.match.title}${s.confidence >= 95 ? " (song stays Preview-only)" : ""}`);
    }
  }, [audio.suggestions, autoApprove.enabled]);

  // --- Internet metadata lookup (title/artist ONLY, NEVER lyrics) --------
  // When a song cue is detected but local library has no strong match, we
  // fire /api/ai/lookup-song-metadata to identify the song by title/artist.
  // The card that renders has NO Preview / NO Send Live buttons — only
  // Search Library / Import Song / Create Song Draft / Reject.
  useEffect(() => {
    // Use the raw song cue detector on the most recent transcript segment.
    const lastFinal = [...audio.transcript].reverse().find((t) => t.final);
    if (!lastFinal) return;
    if (internetLookupFiredRef.current.has(lastFinal.id)) return;
    // Check: was there a local song/lyric match ≥ 60% for this segment?
    const strongLocal = audio.suggestions.some((s) =>
      (s.type === "song" || s.type === "lyric") && s.segmentId === lastFinal.id && s.confidence >= 60,
    );
    if (strongLocal) return;
    // Detect cue on this segment
    import("@/lib/ai-detection/song-cue").then(async ({ detectSongCues }) => {
      const cues = detectSongCues(lastFinal.text);
      if (cues.length === 0) return;
      const candidate = cues[0].candidateTitle?.trim();
      if (!candidate || candidate.length < 3) return;
      internetLookupFiredRef.current.add(lastFinal.id);
      try {
        const res = await fetch("/api/ai/lookup-song-metadata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: candidate }),
        });
        if (!res.ok) return;
        const body = await res.json();
        if (!body.match) return;
        const m = body.match as { title: string; artist: string; source: "musicbrainz" | "degraded_stub"; externalId?: string; confidence: number; url?: string; degraded?: boolean };
        const card: InternetMetadataCard = {
          id: `im-${lastFinal.id}`,
          title: m.title,
          artist: m.artist,
          source: m.source,
          externalId: m.externalId,
          confidence: m.confidence,
          url: m.url,
          degraded: m.degraded,
          matchedText: lastFinal.text.slice(0, 120),
        };
        setInternetMatches((prev) => {
          if (prev.some((p) => p.title.toLowerCase() === card.title.toLowerCase())) return prev;
          return [card, ...prev].slice(0, 5);
        });
      } catch { /* non-fatal */ }
    }).catch(() => { /* non-fatal */ });
  }, [audio.transcript, audio.suggestions]);

  const internetSearchLibrary = useCallback((m: InternetMetadataCard) => {
    setInternetMatches((prev) => prev.filter((p) => p.id !== m.id));
    window.open(`/library/songs?q=${encodeURIComponent(m.title)}`, "_blank");
  }, []);
  const internetImport = useCallback((m: InternetMetadataCard) => {
    setImportModal({ title: m.title, artist: m.artist });
    setInternetMatches((prev) => prev.filter((p) => p.id !== m.id));
  }, []);
  const internetCreateDraft = useCallback(async (m: InternetMetadataCard) => {
    setInternetMatches((prev) => prev.filter((p) => p.id !== m.id));
    try {
      const fd = new FormData();
      fd.set("title", m.title);
      if (m.artist) fd.set("artist", m.artist);
      const { createSong } = await import("@/lib/actions");
      const res = await createSong(fd);
      if (res.ok) toast.success(`Draft created for "${m.title}"`);
      else toast.error(res.error || "Draft creation failed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Draft creation failed");
    }
  }, []);
  const internetReject = useCallback((m: InternetMetadataCard) => {
    setInternetMatches((prev) => prev.filter((p) => p.id !== m.id));
  }, []);

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
  // Y6: memoize liveItemIdx. Previously computed `JSON.stringify(s) === JSON.stringify(live)`
  // for every slide of every item on every render. With plan-level identity as
  // the trigger and a stable liveKey we recompute only when actually needed.
  const liveKey = useMemo(() => {
    try { return JSON.stringify(live); } catch { return ""; }
  }, [live]);
  const liveItemIdx = useMemo(() => {
    if (!liveKey) return -1;
    for (let i = 0; i < plan.items.length; i++) {
      const slides = plan.items[i].slides;
      for (let j = 0; j < slides.length; j++) {
        // Cheap kind check first — skip stringify on obvious mismatches.
        if (slides[j].kind !== live.kind) continue;
        try { if (JSON.stringify(slides[j]) === liveKey) return i; } catch { /* continue */ }
      }
    }
    return -1;
  }, [plan.items, live.kind, liveKey]);

  // Phase 5C: build ctx bag for the new operator shell
  const sendLowerThird = useCallback((line1: string, line2: string) => {
    // R2: merge with the last cached OutputState so we don't clobber
    // announcement / transition / nextItem when sending a lower-third.
    const base: OutputState = lastOutputStateRef.current ?? {
      live, next: nextSlideForStage,
      itemTitle: plan.items[preview.itemIdx]?.title || "",
      slideNumber: `${preview.slideIdx + 1} / ${plan.items[preview.itemIdx]?.slides.length || 0}`,
      aspectRatio, fitMode, safeArea,
      operatorMessage: null,
      lowerThird: null,
      countdownEndsAt,
      announcement,
      transition: transitionSpec,
      nextItem: nextItemForStage,
    };
    const state: OutputState = { ...base, lowerThird: (line1 || line2) ? { line1, line2 } : null };
    safePost(chRef.current, { type: "output", state });
    publishRealtime(state);
    lastOutputStateRef.current = state;
    toast.success(line1 || line2 ? "Lower third sent" : "Lower third cleared");
  }, [live, nextSlideForStage, plan.items, preview.itemIdx, preview.slideIdx, aspectRatio, fitMode, safeArea, countdownEndsAt, announcement, transitionSpec, nextItemForStage, publishRealtime]);

  /**
   * P2 message overlay — a transient lower-third bubble that displays on
   * the projector output on TOP of the current slide, and auto-clears
   * client-side after dismissAfterMs. Distinct from `lowerThird` (which is
   * a persistent livestream/name-strip element) so operators can use both
   * at once without one clobbering the other.
   */
  // R2: operator-side "message live" state so we can render a badge showing
  // exactly what's currently pinned on the projector, with a one-click Hide.
  const [activeMessage, setActiveMessage] = useState<{ text: string; expiresAt: number | null } | null>(null);
  const activeMessageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendMessage = useCallback((text: string, dismissAfterMs?: number | null) => {
    const overlay: MessageOverlay = { text, dismissAfterMs: dismissAfterMs ?? null };
    // Y7: validate before sending so a malformed operator payload never
    // reaches the wire (or the local badge state).
    if (!isValidMessageOverlay(overlay)) {
      toast.error("Message rejected — text length or timer out of bounds");
      return;
    }
    safePost(chRef.current, { type: "message", overlay });
    // Y5: fan out to remote paired projectors via realtime. Embedded into
    // OutputState so subscribers on the current channel API pick it up
    // without needing a new event type on the wire.
    if (rtRef.current && lastOutputStateRef.current) {
      const embedded: OutputState = { ...lastOutputStateRef.current, operatorMessage: text };
      void rtRef.current.publish(embedded);
    }
    const expiresAt = typeof dismissAfterMs === "number" && dismissAfterMs > 0 ? Date.now() + dismissAfterMs : null;
    setActiveMessage({ text, expiresAt });
    if (activeMessageTimerRef.current) { clearTimeout(activeMessageTimerRef.current); activeMessageTimerRef.current = null; }
    if (expiresAt) {
      activeMessageTimerRef.current = setTimeout(() => setActiveMessage(null), Math.max(0, expiresAt - Date.now()));
    }
    toast.success("Message shown on projector");
  }, []);
  const clearMessage = useCallback(() => {
    safePost(chRef.current, { type: "message", overlay: { clear: true } });
    if (rtRef.current && lastOutputStateRef.current) {
      const embedded: OutputState = { ...lastOutputStateRef.current, operatorMessage: null };
      void rtRef.current.publish(embedded);
    }
    if (activeMessageTimerRef.current) { clearTimeout(activeMessageTimerRef.current); activeMessageTimerRef.current = null; }
    setActiveMessage(null);
  }, []);
  useEffect(() => {
    return () => {
      if (activeMessageTimerRef.current) { clearTimeout(activeMessageTimerRef.current); activeMessageTimerRef.current = null; }
    };
  }, []);

  const startCountdown = useCallback((seconds: number) => {
    const target = Date.now() + seconds * 1000;
    setCountdownEndsAt(target);
    toast.success(`Countdown started (${seconds}s)`);
  }, []);

  const currentBankIdx = effectiveBank.findIndex((b) => currentBankRef && b.id === currentBankRef.id);

  // R2: right-click delete callback. Slide-level delete has no server
  // action yet (only removeServiceItem exists) — confirm + toast so the
  // action closes the wrong-slide bug without silently mutating server
  // state. When a slide-delete action lands, replace the toast with a
  // server call scoped by (planId, itemIdx, slideIdx). Documented in
  // DECISIONS.md.
  // Task C: reorder slides within a playlist item. Optimistic local
  // update, then persist via server action. Song items write a per-plan
  // slideOrder override at serviceItems.payload.slideOrder — NEVER touch
  // songSlides.order (church-global). See DECISIONS.md.
  const onReorderSlidesInItem = useCallback((itemIdx: number, newOrder: string[]) => {
    const item = plan.items[itemIdx];
    if (!item) return;
    // Optimistic reorder locally.
    setPlan((prev) => {
      const items = [...prev.items];
      const target = items[itemIdx];
      if (!target) return prev;
      // Build maps by the same id scheme used in SlideGrid.
      const idOf = (i: number) => {
        if (target.type === "song" && target.songSlideRows?.[i]?.id) return target.songSlideRows[i].id;
        return `slide-${i}`;
      };
      const currentIds = target.slides.map((_, i) => idOf(i));
      const bySlideId = new Map(currentIds.map((id, i) => [id, target.slides[i]]));
      const byRowId = target.songSlideRows
        ? new Map(currentIds.map((id, i) => [id, target.songSlideRows![i]]))
        : null;
      const reorderedSlides = newOrder.map((id) => bySlideId.get(id)!).filter(Boolean);
      const reorderedRows = byRowId
        ? newOrder.map((id) => byRowId.get(id)!).filter(Boolean)
        : undefined;
      items[itemIdx] = {
        ...target,
        slides: reorderedSlides,
        ...(reorderedRows ? { songSlideRows: reorderedRows } : {}),
      };
      return { ...prev, items };
    });
    // Persist.
    (async () => {
      try {
        const { reorderItemSlides } = await import("@/lib/actions");
        const res = await reorderItemSlides(plan.id, item.id, newOrder);
        if (!res.ok) {
          toast.error(res.error || "Reorder failed");
          router.refresh();
          return;
        }
        router.refresh();
      } catch (err) {
        toast.error("Reorder failed");
        router.refresh();
      }
    })();
  }, [plan.items, plan.id, router]);

  // Slide-level delete is intentionally not exposed as a bare callback here.
  // Individual slide removal for song/scripture items requires per-type
  // schema editing (song lyric split vs scripture range) and lives in the
  // slide editor path. Callers that used to hit `onDeleteSlide` now just
  // treat the callback as a no-op.
  const onDeleteSlide = useCallback((_itemIdx: number, _slideIdx: number) => {
    /* handled inside the item editor */
  }, []);

  const shellCtx: OperatorShellCtx = useMemo(() => ({
    plan,
    previewSlide,
    liveSlide: live,
    previewItemIdx: preview.itemIdx,
    previewSlideIdx: preview.slideIdx,
    liveItemIdx,
    aspectRatio, fitMode, safeArea,
    onAspectChange: setAspectRatio,
    onFitChange: setFitMode,
    onSafeAreaToggle: () => setSafeArea((v) => !v),
    autopilotMode, onAutopilotModeChange: setAutopilotMode,
    autoApproveOn: autoApprove.enabled,
    autoSendToLive: autoApprove.autoSendToLive,
    audio,
    onListenToggle: () => audio.listening ? stopAudio() : startAudio(),
    onResumeAudio: resumeAudio,
    onRestartAudio: restartAudio,
    onWarmStartAudio: warmStartAudio,
    confidenceThreshold,
    defaultTranslationCode,
    onJumpSlide: jumpTo,
    onSetPreviewItem: (i) => jumpTo(i, 0),
    onSendToLive: sendPreview,
    onBlank: goBlank, onLogo: goLogo, onKill: clearLive,
    onClearSlide: clearSlide, onClearMedia: clearMedia,
    onClearLowerThird: clearLowerThird, onStageMessage: stageMessage,
    onSendLowerThird: sendLowerThird,
    onSendMessage: sendMessage,
    onClearMessage: clearMessage,
    onStartCountdown: startCountdown,
    countdownEndsAt,
    onOpenProjector: openProjector,
    onOpenStage: openStageDisplay,
    onOpenStream: openLivestream,
    planId: plan.id,
    endServiceHasTranscript: audio.transcript.length > 0,
    bank: effectiveBank,
    currentBankIdx: currentBankIdx >= 0 ? currentBankIdx : null,
    onRecallBanked: recallBanked,
    onApproveDetection: approveDetection,
    onRejectDetection: rejectDetection,
    onApproveSong: approveSong,
    onRejectSong: rejectSong,
    onEditSong: editSong,
    onApproveCommand: approveCommand,
    onRejectCommand: rejectCommand,
    onEditCommand: editCommand,
    onPreviewUnified: previewUnified,
    onSendLiveUnified: sendLiveUnified,
    onQueueUnified: queueUnified,
    onRejectUnified: rejectUnified,
    onImportSong: importSong,
    internetMatches,
    onInternetSearchLibrary: internetSearchLibrary,
    onInternetImport: internetImport,
    onInternetCreateDraft: internetCreateDraft,
    onInternetReject: internetReject,
    onSimulate: simulateTranscript,
    historyKey,
    // Phase 5D-2
    announcement,
    onSetAnnouncement: setAnnouncement,
    transitionSpec,
    onSetTransitionSpec: setTransitionSpec,
    churchId: (plan as unknown as { churchId?: string }).churchId ?? "",
    // Bible-panel wiring
    onSendSlideToLive: sendSlideToLive,
    onStageSlide: stageSlide,
    onBankAddReference: bankAdd,
    onSendBankedToLive: sendBankedToLive,
    onRemoveBanked: removeBanked,
    onDeleteSlide, // R2
    onReorderSlidesInItem, // Task C
    // Library → Playlist add (drag or click).
    onAddLibraryItem: async (kind, ref) => {
      const payload =
        kind === "song" ? { songId: ref.id } :
        kind === "media" ? { mediaAssetId: ref.id } :
        { pptxImportId: ref.id };
      const { addServiceItem } = await import("@/lib/actions");
      const res = await addServiceItem(plan.id, kind, ref.title, payload);
      if (res.ok) {
        toast.success(`Added: ${ref.title}`);
        // R2 (P6): optimistic append + router.refresh instead of full page
        // reload. Full reload broke interim transcript state, forced a mic
        // re-prompt, and dropped BroadcastChannel state (CLAUDE.md rule 8).
        // router.refresh() re-fetches server component data without
        // remounting the whole app.
        const optimisticId = `optimistic-${Date.now()}`;
        setPlan((prev) => {
          const newItem = {
            id: optimisticId,
            title: ref.title,
            type: kind,
            songId: kind === "song" ? ref.id : undefined,
            mediaAssetId: kind === "media" ? ref.id : undefined,
            pptxImportId: kind === "sermon" ? ref.id : undefined,
            slides: [],
          } as unknown as ExpandedItem;
          return { ...prev, items: [...prev.items, newItem] };
        });
        // Focus preview on the newly added item.
        setPreview({ itemIdx: plan.items.length, slideIdx: 0 });
        router.refresh();
      } else {
        toast.error(res.error || "Add failed");
      }
    },
  }), [
    // Y6: only re-pack when the values consumers actually read change.
    plan, previewSlide, live, preview.itemIdx, preview.slideIdx, liveItemIdx,
    aspectRatio, fitMode, safeArea, autopilotMode, autoApprove.enabled,
    autoApprove.autoSendToLive, audio, confidenceThreshold, defaultTranslationCode,
    countdownEndsAt, announcement, transitionSpec,
    effectiveBank, currentBankIdx, internetMatches, historyKey,
    // callbacks
    setAspectRatio, setFitMode, setAutopilotMode, jumpTo, sendPreview,
    goBlank, goLogo, clearLive, clearSlide, clearMedia, clearLowerThird,
    stageMessage, sendLowerThird, sendMessage, clearMessage, startCountdown, openProjector,
    openStageDisplay, openLivestream, recallBanked, approveDetection,
    rejectDetection, approveSong, rejectSong, editSong, approveCommand,
    rejectCommand, editCommand, previewUnified, sendLiveUnified,
    queueUnified, rejectUnified, importSong, internetSearchLibrary,
    internetImport, internetCreateDraft, internetReject, simulateTranscript,
    setAnnouncement, setTransitionSpec, sendSlideToLive, stageSlide,
    bankAdd, sendBankedToLive, removeBanked, onDeleteSlide, onReorderSlidesInItem,
    startAudio, stopAudio,
  ]);

  return (
    <>
      <div className="fixed top-2 right-3 z-40 flex items-center gap-2">
        {/* R2: persistent "Message live" indicator so the operator can't
            forget a pinned overlay is still up (dismissAfterMs=null case). */}
        {activeMessage && (
          <div className="flex items-center gap-2 px-2 py-1 rounded border border-amber-400/50 bg-amber-500/10 text-amber-200 text-[11px] font-semibold max-w-[420px]">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-300 animate-pulse" />
            <span className="uppercase tracking-widest text-[9px] text-amber-300/80">Msg</span>
            <span className="truncate" title={activeMessage.text}>{activeMessage.text}</span>
            <button
              type="button"
              onClick={clearMessage}
              className="ml-1 px-1.5 py-0.5 rounded border border-amber-300/40 text-amber-100 hover:bg-amber-400/20 text-[10px] font-bold uppercase tracking-wider"
            >
              Hide
            </button>
          </div>
        )}
        {/* SyncControl is fixed top-right and collided with ProOperatorShell's
            Live/Audience/Stage pills in the top toolbar. Only render for the
            legacy web shell; desktop exposes pair codes via the Settings tab. */}
        {shell !== "desktop" && (
          <SyncControl planId={plan.id} churchId={churchIdForChannel} onCodeChange={setPairCode} />
        )}
      </div>
      {/* R3: Desktop shell = ProOperatorShell; web keeps the legacy OperatorShell. */}
      {shell === "desktop" ? <ProOperatorShell ctx={shellCtx} /> : <OperatorShell ctx={shellCtx} />}
      <ImportSongModal
        open={importModal !== null}
        initialTitle={importModal?.title || ""}
        initialArtist={importModal?.artist || ""}
        onClose={() => setImportModal(null)}
      />
      <EditSuggestionModal
        open={editing !== null}
        suggestion={editing}
        onClose={() => setEditing(null)}
        onSaved={onSuggestionEdited}
      />
    </>
  );
}

// Legacy full-layout return kept for reference / rollback. Not used.

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
