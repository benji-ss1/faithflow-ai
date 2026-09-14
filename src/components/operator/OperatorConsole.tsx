"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { decidePlanPropChange } from "@/lib/operator-plan-select";
import { ArrowLeft, ChevronLeft, ChevronRight, Monitor, Radio, Square, Sun, PanelRightClose, PanelRightOpen } from "lucide-react";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import { openLiveChannel, type LiveChannelLike, safePost, isValidMessageOverlay, AI_AUTO_TRANSITION, slideOutputIdentity, sanitizeOutputState, scrubOutputStateForRemote, type SlidePayload, type LiveMessage, type OutputState, type MessageOverlay } from "@/lib/broadcast";
import { LAYERS_V2 } from "@/lib/output-layers";
import { nextPreviewPosition } from "@/lib/operator-nav";
import { dispatchInternal } from "@/lib/internal-events";
import { useLiveLayers } from "./useLiveLayers";
import { clampObsBand, type ObsBandConfig } from "@/lib/obs-lowerthird";
import { OBS_EDITOR_KEY, LEGACY_BAND_KEY, LEGACY_LOOK_KEY, readObsEditorStore, obsLookWireFromStore, publishObsPreviewState, heldLowerThirdFor, createTrailingPublisher, type HeldLowerThird } from "@/lib/obs-look";
import type { ObsLookWire } from "@/lib/broadcast";
import { readFontScale, readReferenceScale, readReferenceColor } from "./pro/operatorConstants";
import { applyChurchLayout, sourceForRelayout } from "./scripture/scriptureStyle";
import { inferLiveOrigin, type LiveOrigin, recallOrigin, rememberOrigin, carriedOrigin } from "@/lib/song-switch-guard";
import { useBackgroundState } from "@/backgrounds/hooks/useBackgroundState";
import { toBackgroundSpec } from "@/backgrounds/models/BackgroundTypes";
import { openOutputChannel } from "@/lib/realtime";
import { SyncControl } from "./SyncControl";
import type { ExpandedPlan, ExpandedItem } from "@/lib/server/services";
import { cn } from "@/lib/utils";
import { setAiHealth, startDataHealthPolling } from "@/lib/connection/connectionHealth";
import { hydratePublicDomainBibleInBackground } from "@/lib/offline/bibleHydration";
import { ServiceModeBanner } from "@/components/system/ServiceModeBanner";
import { useAudioStream, type Detection, type SongSuggestion, type CommandSuggestion, type UnifiedSuggestion } from "./useAudioStream";
import type { IndexedSong } from "@/lib/ai-detection/lyric-fragment";
import { AIAssistantPanel, ListeningToggle } from "./AIAssistantPanel";
import { OperatorErrorBoundary } from "./OperatorErrorBoundary";
import { updateDetectionStatus, updateAiSuggestionStatus, reorderServiceItems } from "@/lib/actions";
import { insertIdAtIndex } from "@/lib/spring-load";
import { SuggestionHistory } from "./SuggestionHistory";
import { EditSuggestionModal, type EditableSuggestion } from "./EditSuggestionModal";
import { transition } from "@/lib/autopilot";
import { useVerseBank, type BankedVerse } from "./useVerseBank";
import { loadSessionState, updateSessionState } from "@/lib/operatorSessionState";
import { parseContextCommand } from "@/lib/context-parser";
import { Bookmark, Zap, Music2, Mic2, Wand2, MicOff } from "lucide-react";
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
import { dispatchAction, type EngineAction, type DispatchResult } from "@/engine/actions";
import { setMediaAsBackground, normalizeMediaKind } from "@/backgrounds/mediaAsBackground";
import { sanitizeSlideActions, dispatchSlideActions } from "@/engine/slide-actions";
import { describeSpec } from "@/engine/actions/describe";
import type { MacroDefinition } from "@/engine/macros";
import { useProjectionZoneStore } from "@/lib/projection-zone-store";
import { normalizeZone, DEFAULT_ZONE, type ProjectionZone } from "@/lib/projection-zone";
import { ZoneEditor } from "./zone/ZoneEditor";
import { useShell } from "@/hooks/useShell";

type Cursor = { itemIdx: number; slideIdx: number };

// 2026-07-25 Bug-3: operator's AI ON/OFF intent, persisted across sessions so
// the console resumes listening on load without a manual re-arm. Deliberately
// localStorage (not sessionStorage like auto-approve): auto-LISTENING is safe
// to restore — it never sends anything to live on its own.
const AI_LISTEN_INTENT_KEY = "presentflow.pro.aiListenIntent.v1";

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

// ── Service mode (Worship / Preacher / Auto) ──────────────────────────────
// An operator-facing bias for the DETECTION engine — it does NOT touch capture,
// the mic board, or the auto-fire gates. It only nudges the confidences those
// gates already read (see src/lib/ai-detection/index.ts):
//   "auto"     → today's behaviour, exactly. Pure no-op.
//   "worship"  → narrow song-matching to TODAY'S setlist + boost those songs so
//                real worship actually crosses the auto bar (the "picked up
//                nothing during the choir" fix), and hold scripture at chip-tier
//                so a sung lyric can't flash a wrong verse.
//   "preacher" → hold songs at chip-tier (never zero-click a song off speech),
//                scripture behaves normally.
// Session-scoped (survives a reload, resets on app restart) so a service starts
// from the operator's conscious choice, mirroring the autopilot re-arm policy.
export type ServiceMode = "auto" | "worship" | "preacher";
const SERVICE_MODE_KEY = "presentflow.pro.serviceMode.v1";

const AUTOPILOT_MODE_KEY = "presentflow.autopilot.mode";

export function OperatorConsole({ plan: planProp, churchId, defaultTranslationCode: initialTranslationCode, confidenceThreshold, autoApprove: autoApproveProp, layersV2: layersV2Prop = false, initialShell }: {
  plan: ExpandedPlan;
  churchId: string;
  defaultTranslationCode: string;
  confidenceThreshold: number;
  autoApprove: AutoApproveConfig;
  /** Decoupling Phase 3: per-church opt-in for the layers engine. Combined with
   *  the global NEXT_PUBLIC_LAYERS_V2 kill-switch to gate the Layers Panel. */
  layersV2?: boolean;
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
  // Never silently swap to a DIFFERENT plan on refresh (2026-09-14 field bug:
  // a post-midnight refresh resolved a new empty "today" plan). Same id → adopt;
  // different id on the /operator landing → keep the current plan + offer a switch.
  const planIdRef = useRef<string>(planProp.id);
  useEffect(() => {
    const onLanding = typeof window !== "undefined" && window.location.pathname === "/operator";
    if (decidePlanPropChange(planIdRef.current, planProp.id, onLanding) === "adopt") {
      planIdRef.current = planProp.id;
      setPlan(planProp);
      return;
    }
    toast("A different service was loaded", {
      id: "operator-plan-swap",
      description: "Your current playlist is still on screen.",
      duration: 15000,
      action: {
        label: "Switch to today's service",
        onClick: () => {
          planIdRef.current = planProp.id;
          setPlan(planProp);
          try {
            const u = new URL(window.location.href);
            u.searchParams.set("plan", planProp.id);
            router.replace(u.pathname + u.search, { scroll: false });
          } catch { /* ignore */ }
        },
      },
    });
  }, [planProp]);
  // Pin the landing URL to the plan on screen so router.refresh() reloads it.
  useEffect(() => {
    if (typeof window === "undefined" || window.location.pathname !== "/operator" || !plan?.id) return;
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.get("plan") === plan.id) return;
      u.searchParams.set("plan", plan.id);
      // Via the Next router: a raw history.replaceState is overwritten by the
      // router's canonical URL on the next refresh (caught by the local E2E).
      router.replace(u.pathname + u.search, { scroll: false });
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.id]);
  // Hybrid Phase 1 — durably snapshot the current service (church-scoped) for
  // offline fallback. Best-effort + dynamically imported so it can never affect
  // the online path. Snapshots the LIVE `plan` (including the operator's
  // optimistic edits), debounced, so an offline restore reflects exactly what
  // they last saw — not a stale server copy.
  useEffect(() => {
    if (!churchId || !plan?.id) return;
    const t = setTimeout(() => {
      void import("@/lib/offline/serviceCache").then(({ saveServiceSnapshot }) =>
        saveServiceSnapshot(churchId, plan.id, plan),
      ).catch(() => { /* best-effort */ });
    }, 1000);
    return () => clearTimeout(t);
  }, [plan, churchId]);

  // Hybrid Phase 3 — offline plan RESTORE. When the operator screen loads with
  // no network (the Electron-cache path serves a possibly-stale cached page),
  // the server-rendered `planProp` may be old or empty. Restore the last-saved
  // live snapshot from IndexedDB so the service is exactly where they left it.
  // Runs once, ONLY when offline — online, the server plan is authoritative and
  // is never overridden. loadServiceSnapshot enforces the church_id boundary.
  const planRestoreTriedRef = useRef(false);
  useEffect(() => {
    if (planRestoreTriedRef.current) return;
    planRestoreTriedRef.current = true;
    if (typeof navigator !== "undefined" && navigator.onLine) return;
    if (!churchId || !planProp?.id) return;
    void import("@/lib/offline/serviceCache").then(async ({ loadServiceSnapshot }) => {
      const snap = await loadServiceSnapshot<ExpandedPlan>(churchId, planProp.id);
      if (snap?.plan && snap.plan.id === planProp.id && Array.isArray(snap.plan.items) && snap.plan.items.length > 0) {
        setPlan(snap.plan);
      }
    }).catch(() => { /* best-effort — fall back to planProp */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
      // 2026-07-25 security fix (review 🔴): read sessionStorage ONLY, matching
      // the Y3 decision that auto-LIVE must be consciously re-armed each
      // session. This was reading localStorage, which — combined with the new
      // AI-listening auto-start — let two XSS-written localStorage keys arm a
      // zero-touch mic→detect→auto-live chain on every future app launch.
      // Same reason the legacy autopilot key below may hydrate any mode
      // EXCEPT "active": localStorage can restore preferences, never live-fire.
      const autoRaw = window.sessionStorage.getItem("presentflow.pro.autoApprove.v1");
      if (autoRaw === "1") { setAutopilotModeInner("active"); return; }
      if (autoRaw === "0") { setAutopilotModeInner("suggestion"); return; }
      // 2026-08-16 (user sign-off): restore the operator's AUTO choice ACROSS
      // restarts from the persistent key, so the service starts hot. This is a
      // deliberate override of the session-only re-arm policy for the church's
      // own desktop machine — the operator asked for AUTO to stay ON. sessionKey
      // (above) still wins within a session; this only fills the cold-start gap.
      const autoPersist = window.localStorage.getItem("presentflow.pro.autoApprove.persist.v1");
      if (autoPersist === "1") { setAutopilotModeInner("active"); return; }
      if (autoPersist === "0") { setAutopilotModeInner("suggestion"); return; }
      const raw = window.localStorage.getItem(AUTOPILOT_MODE_KEY);
      if (raw === "manual" || raw === "suggestion" || raw === "armed") {
        setAutopilotModeInner(raw);
      } else if (raw === "active") {
        setAutopilotModeInner("armed"); // one keypress from live, never auto
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
  // Service mode (Worship / Preacher / Auto) — detection bias only. Init "auto"
  // deterministically for SSR; hydrate the operator's session choice post-mount.
  const [serviceMode, setServiceModeInner] = useState<ServiceMode>("auto");
  const serviceModeRef = useRef<ServiceMode>("auto");
  serviceModeRef.current = serviceMode;
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(SERVICE_MODE_KEY);
      if (raw === "worship" || raw === "preacher" || raw === "auto") setServiceModeInner(raw);
    } catch { /* noop */ }
  }, []);
  const setServiceMode = useCallback((next: ServiceMode) => {
    setServiceModeInner((prev) => {
      if (prev === next) return prev;
      try { window.sessionStorage.setItem(SERVICE_MODE_KEY, next); } catch { /* noop */ }
      const label = next === "worship" ? "Worship mode" : next === "preacher" ? "Preacher mode" : "Auto mode";
      const icon = next === "worship"
        ? <Music2 className="w-4 h-4" style={{ color: "var(--color-worship-soft)" }} />
        : next === "preacher"
          ? <Mic2 className="w-4 h-4" style={{ color: "var(--color-scripture-gold, #EF9F27)" }} />
          : <Wand2 className="w-4 h-4" style={{ color: "var(--color-brand)" }} />;
      // 2026-08-30: the mode BIASES detection only — it does NOT control whether
      // verses auto-PROJECT. Scripture auto-projection follows the separate AUTO
      // toggle (autopilotMode === "active"); earlier copy ("…both auto") implied
      // the mode did it, so operators picked Preacher expecting hands-free verses
      // with AUTO off and got only chips. Be honest, and nudge to turn AUTO on.
      const autoOn = autopilotMode === "active";
      const autoNote = autoOn ? "" : " · turn on AUTO to auto-project verses";
      const detail = next === "worship"
        ? "Detecting today's worship set; scripture held for manual"
        : next === "preacher"
          ? `Scripture prioritised; songs held for manual${autoNote}`
          : `Songs & scripture both eligible${autoNote}`;
      toast(`${label}`, { description: detail, icon, duration: 2600 });
      return next;
    });
  }, [autopilotMode]);

  const autoApprove = useMemo<AutoApproveConfig>(() => ({
    enabled: autopilotMode === "active",
    confidenceFloor: autoApproveProp.confidenceFloor,
    autoSendToLive: autoApproveProp.autoSendToLive,
  }), [autopilotMode, autoApproveProp.confidenceFloor, autoApproveProp.autoSendToLive]);
  const shell = useShell(initialShell);
  const [preview, setPreview] = useState<Cursor>({ itemIdx: 0, slideIdx: 0 });
  // JPD Fix 5 (2026-07-27): restore the operator's last PREVIEW position on
  // relaunch. Preview-only — never touches the live output. Guarded by plan
  // id (a different plan starts at the top) and 12h staleness (inside
  // loadSessionState). Runs once post-mount so SSR hydration stays clean.
  const sessionRestoredRef = useRef(false);
  useEffect(() => {
    if (sessionRestoredRef.current) return;
    sessionRestoredRef.current = true;
    const saved = loadSessionState();
    if (!saved || saved.activePlanId !== planProp.id) return;
    const itemIdx = Math.min(Math.max(0, saved.lastActiveItemIdx), Math.max(0, planProp.items.length - 1));
    const item = planProp.items[itemIdx];
    if (!item) return;
    const slideIdx = Math.min(Math.max(0, saved.lastActiveSlideIdx), Math.max(0, item.slides.length - 1));
    setPreview({ itemIdx, slideIdx });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [live, setLiveRaw] = useState<SlidePayload>({ kind: "empty" });
  // Live-send counter: bumps on every send that changes what's live — a new
  // slide identity OR the same content from a DIFFERENT deck position (repeated
  // chorus / blank). Never bumps on heartbeats or an already-live re-send of the
  // same position. The operator's title is held against this, not content.
  const [liveSendSeq, setLiveSendSeq] = useState(0);
  const liveSendSeqRef = useRef(0);
  const livePosRef = useRef<string | null>(null);
  // ── Live projection UNDO / REDO (Google-Docs-style back/forward for the
  // output). History is recorded centrally by watching `live` (below), so it
  // captures EVERY path that changes the projector — manual sends, editor Show,
  // AI auto-fires, chip clicks — without threading through each call site.
  // History entries carry the live ORIGIN recorded at send time, replayed on
  // undo/redo (never re-resolved) so a song stays attributed to its song.
  type LiveHistoryEntry = { slide: SlidePayload; origin: LiveOrigin | null };
  const liveUndoStackRef = useRef<LiveHistoryEntry[]>([]);
  const liveRedoStackRef = useRef<LiveHistoryEntry[]>([]);
  const livePrevOriginRef = useRef<LiveOrigin | null>(null);
  const livePrevRef = useRef<SlidePayload>({ kind: "empty" });
  const liveUndoRedoInFlightRef = useRef(false);
  const [liveHistoryVer, setLiveHistoryVer] = useState(0);
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
  // One-shot marker for a slide whose transition is decided at fire-time rather
  // than from the operator's configured `transitionSpec`. `transition: null`
  // means a hard cut (Bible card clicks — the configured theme fade is visible
  // latency there); a spec means a forced transition (AI auto-fires use the fast
  // AI_AUTO_TRANSITION so they animate smoothly without dragging on live speech).
  const fastTransitionSlideRef = useRef<{ slide: SlidePayload; transition: import("@/lib/broadcast").TransitionSpec | null } | null>(null);
  const [liveBroadcastRevision, setLiveBroadcastRevision] = useState(0);

  // Compute next-slide payload for /stage
  const nextSlideForStage: SlidePayload | null = (() => {
    const item = plan.items[preview.itemIdx];
    if (!item) return null;
    if (preview.slideIdx + 1 < item.slides.length) return item.slides[preview.slideIdx + 1];
    const nextItem = plan.items[preview.itemIdx + 1];
    return nextItem?.slides[0] ?? null;
  })();

  // B3 — operator manual text-size multiplier, synced to all output surfaces
  // via OutputState. Read from localStorage on mount; TopBar A−/AUTO/A+ writes
  // the pref and fires `presentflow:font-scale-changed` which we listen for.
  const [fontScale, setFontScale] = useState(1);
  // Projection Zone Customizer: the active profile's geometry drives both the
  // preview and every output (via OutputState.zone). Its fontScale multiplier is
  // folded into the fontScale field so a single number reaches AutoFitText.
  const zoneStore = useProjectionZoneStore();
  const activeZone: ProjectionZone = zoneStore.activeProfile ? normalizeZone(zoneStore.activeProfile) : DEFAULT_ZONE;
  const effectiveFontScale = fontScale * activeZone.fontScale;
  const [zoneEditorOpen, setZoneEditorOpen] = useState(false);
  // The floating Projection-Zone button was removed; keep the editor reachable
  // via a custom event (fired from menus / hotkeys / future entry points).
  useEffect(() => {
    const open = () => setZoneEditorOpen(true);
    window.addEventListener("presentflow:open-zone-editor", open);
    return () => window.removeEventListener("presentflow:open-zone-editor", open);
  }, []);
  useEffect(() => {
    setFontScale(readFontScale());
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const v = typeof detail?.scale === "number" ? detail.scale : readFontScale();
      setFontScale(v);
    };
    window.addEventListener("presentflow:font-scale-changed", onChange);
    return () => window.removeEventListener("presentflow:font-scale-changed", onChange);
  }, []);
  // Independent reference-footer size (mirrors font-scale). Published on
  // OutputState so the projector footer sizes to the operator's preference.
  const [referenceScale, setReferenceScale] = useState(1);
  useEffect(() => {
    setReferenceScale(readReferenceScale());
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const v = typeof detail?.scale === "number" ? detail.scale : readReferenceScale();
      setReferenceScale(v);
    };
    window.addEventListener("presentflow:reference-scale-changed", onChange);
    return () => window.removeEventListener("presentflow:reference-scale-changed", onChange);
  }, []);
  const [referenceColor, setReferenceColor] = useState("");
  useEffect(() => {
    setReferenceColor(readReferenceColor());
    const onChange = (e: Event) => {
      const c = (e as CustomEvent).detail?.color;
      setReferenceColor(typeof c === "string" ? c : readReferenceColor());
    };
    window.addEventListener("presentflow:reference-color-changed", onChange);
    return () => window.removeEventListener("presentflow:reference-color-changed", onChange);
  }, []);

  // Background Templates: active background → compact spec published on
  // OutputState so the projector's BackgroundLayer renders it.
  const { active: activeBackground } = useBackgroundState();
  const backgroundSpec = useMemo(() => toBackgroundSpec(activeBackground), [activeBackground]);

  // Themes Phase 1 — active theme appearance emitted on OutputState so the
  // projector/stage/livestream reflect the church's applied theme. Resolved
  // from the default theme on mount; the Themes tab's Apply fires
  // `presentflow:theme-changed` (same-machine, like font-scale) for instant
  // live-apply without a refetch.
  const [appearance, setAppearance] = useState<import("@/lib/broadcast").ThemeAppearance | null>(null);
  // Themes 2c — all church themes cached by id so we can resolve a per-item
  // "section theme" override. `themesVersion` bumps when the cache changes.
  const themesByIdRef = useRef<Map<string, unknown>>(new Map());
  const [themesVersion, setThemesVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const userTouched = { current: false }; // an Apply during the in-flight fetch wins
    type ThemeRow = { id?: string; config?: unknown; isDefault?: boolean };
    // Uses the real `churchId` prop (was previously read off planProp, which
    // never carries churchId — so the offline theme cache silently no-op'd).
    const applyList = async (list: ThemeRow[]) => {
      themesByIdRef.current = new Map(list.filter((t) => typeof t.id === "string").map((t) => [t.id as string, t.config]));
      if (!cancelled) setThemesVersion((v) => v + 1);
      const active = list.find((t) => t.isDefault) ?? null;
      if (!cancelled && !userTouched.current && active) {
        const { themeConfigToAppearance, appearanceHasBackground } = await import("@/lib/theme-appearance");
        const mapped = themeConfigToAppearance(active.config);
        setAppearance(mapped);
        // Self-heal a stale Background Template left active in a prior session:
        // under the mutually-exclusive rule, the church's default theme background
        // is the source of truth, so on load a leftover template that would
        // otherwise override it (overVideo on /live) is cleared. Only when the
        // default theme actually carries its OWN background — a text-only default
        // theme leaves any template alone so the two can still be layered.
        if (!cancelled && appearanceHasBackground(mapped)) {
          const { readActiveBackgroundId, setActiveBackgroundId, shouldKeepTemplateOverThemeBg } = await import("@/backgrounds/store/backgroundStore");
          // Only clear a leftover template if the theme background was the more
          // recent explicit choice; otherwise the operator's last-picked
          // template (e.g. Gentle Waves) persists across the app restart.
          if (readActiveBackgroundId() !== "none" && !shouldKeepTemplateOverThemeBg()) setActiveBackgroundId("none");
        }
      }
    };
    const load = async () => {
      try {
        const res = await fetch("/api/themes");
        if (!res.ok) throw new Error("themes fetch failed");
        const data = (await res.json()) as { themes?: ThemeRow[] };
        const list = data.themes ?? [];
        await applyList(list);
        // Hybrid Phase 1 — cache the themes list so themed styling still works
        // offline (colors/fonts/gradients; media backgrounds cache separately).
        if (churchId) void import("@/lib/offline/serviceCache").then(({ saveKv }) => saveKv(churchId, "themes", list)).catch(() => {});
      } catch {
        // Offline / server unreachable → fall back to the cached themes list.
        if (!churchId) return;
        try {
          const { loadKv } = await import("@/lib/offline/serviceCache");
          const cached = await loadKv<ThemeRow[]>(churchId, "themes");
          if (cached && !cancelled) await applyList(cached);
        } catch { /* built-in defaults */ }
      }
    };
    void load();
    const onChange = (e: Event) => {
      userTouched.current = true; // don't let the stale mount-fetch clobber this
      const detail = (e as CustomEvent).detail;
      const nextAppearance = detail?.appearance ?? null;
      setAppearance(nextAppearance);
      // Mutually-exclusive backgrounds (user-approved 2026-08-28): applying a
      // theme that carries its OWN background turns OFF any active Background
      // Template, so the theme's background actually reaches the projector — a
      // template would otherwise override it (overVideo → transparent slide) on
      // /live. A text-only theme (fonts/colour, no background) leaves the
      // template alone, so the two can still coexist (theme text over template).
      void import("@/lib/theme-appearance").then(({ appearanceHasBackground }) => {
        if (appearanceHasBackground(nextAppearance)) {
          // Explicit in-session theme apply → this IS the newest pick, so it
          // wins over any active template AND is stamped so it persists.
          void import("@/backgrounds/store/backgroundStore").then(({ setActiveBackgroundId, markThemeBackgroundPicked }) => {
            markThemeBackgroundPicked();
            setActiveBackgroundId("none");
          });
        }
      });
      void load(); // refresh the by-id cache (default may have changed)
    };
    window.addEventListener("presentflow:theme-changed", onChange);
    return () => { cancelled = true; window.removeEventListener("presentflow:theme-changed", onChange); };
  }, []);

  // liveItemIdx — which plan item is currently LIVE on the projector (-1 if
  // none). Relocated here (2026-08-12) so the section-theme resolution below can
  // key off the LIVE item instead of the preview cursor. Deps unchanged.
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
    // 2026-09-14: every send is laid out (applyChurchLayout), so on a lower-third
    // church the live slide is the BANDED form and never byte-equals the raw plan
    // slide above. Fall back to content identity: the live slide reduced to its
    // source (sourceForRelayout) vs the raw plan slide, or the live slide vs the
    // plan slide run through the same church layout.
    try {
      const liveId = slideOutputIdentity(live);
      const srcId = slideOutputIdentity(sourceForRelayout(live));
      for (let i = 0; i < plan.items.length; i++) {
        for (const ps of plan.items[i].slides) {
          if (ps.kind !== live.kind) continue;
          const pid = slideOutputIdentity(ps);
          if (pid === srcId || pid === liveId) return i;
          if (slideOutputIdentity(applyChurchLayout(ps, churchId)) === liveId) return i;
        }
      }
    } catch { /* fall through */ }
    return -1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.items, live.kind, liveKey, churchId]);

  // Themes 2c — resolve the LIVE item's section-theme override (if any) into its
  // own appearance. Anchored to the LIVE item (not the preview cursor) so that
  // navigating the playlist / clicking a Song-Detection chip NEVER changes the
  // projector theme — only what is actually LIVE (or, when nothing is live, the
  // applied church default `appearance`) drives it. When set it wins over the
  // default; unset (every existing plan, or nothing live) → null → default used.
  const currentItemThemeId = (plan.items[liveItemIdx] as { themeId?: string } | undefined)?.themeId ?? null;
  const [itemAppearance, setItemAppearance] = useState<import("@/lib/broadcast").ThemeAppearance | null>(null);
  useEffect(() => {
    if (!currentItemThemeId) { setItemAppearance(null); return; }
    const cfg = themesByIdRef.current.get(currentItemThemeId);
    if (!cfg) { setItemAppearance(null); return; }
    let cancelled = false;
    void import("@/lib/theme-appearance").then(({ themeConfigToAppearance }) => {
      if (!cancelled) setItemAppearance(themeConfigToAppearance(cfg));
    });
    return () => { cancelled = true; };
  }, [currentItemThemeId, themesVersion]);
  // Per-content-type default style: when the LIVE item has no explicit per-item
  // theme, its TYPE (song / scripture) selects a default theme; else the church
  // default. Operator-machine setting (localStorage), same-machine event-driven.
  const [contentStyles, setContentStyles] = useState<import("@/lib/content-type-styles").ContentTypeStyles>({});
  useEffect(() => {
    let alive = true;
    const load = () => import("@/lib/content-type-styles").then(({ loadContentTypeStyles }) => { if (alive) setContentStyles(loadContentTypeStyles()); });
    void load();
    const onChange = () => void load();
    window.addEventListener("presentflow:content-type-styles-changed", onChange);
    return () => { alive = false; window.removeEventListener("presentflow:content-type-styles-changed", onChange); };
  }, []);
  const liveItemType = (plan.items[liveItemIdx] as { type?: string } | undefined)?.type;
  const contentTypeThemeId = liveItemType === "song" ? (contentStyles.song ?? null) : liveItemType === "scripture" ? (contentStyles.scripture ?? null) : null;
  const [contentTypeAppearance, setContentTypeAppearance] = useState<import("@/lib/broadcast").ThemeAppearance | null>(null);
  useEffect(() => {
    if (!contentTypeThemeId) { setContentTypeAppearance(null); return; }
    const cfg = themesByIdRef.current.get(contentTypeThemeId);
    if (!cfg) { setContentTypeAppearance(null); return; }
    let cancelled = false;
    void import("@/lib/theme-appearance").then(({ themeConfigToAppearance }) => {
      if (!cancelled) setContentTypeAppearance(themeConfigToAppearance(cfg));
    });
    return () => { cancelled = true; };
  }, [contentTypeThemeId, themesVersion]);
  // The appearance actually emitted: per-item theme wins, then the content-type
  // default for the live item, then the church default.
  const effectiveAppearance = itemAppearance ?? contentTypeAppearance ?? appearance;

  // Mutual-exclusivity heal against the EFFECTIVE appearance (2026-08-29): the
  // mount + theme-changed heals only cleared a Background Template when the
  // DEFAULT theme carried a background — a per-item or content-type theme with
  // its own background left a stale template active, which suppressed it on
  // /live (overVideo → transparent). Clear the template whenever the appearance
  // actually being emitted has its own background.
  useEffect(() => {
    if (!effectiveAppearance) return;
    void import("@/lib/theme-appearance").then(({ appearanceHasBackground }) => {
      if (!appearanceHasBackground(effectiveAppearance)) return;
      void import("@/backgrounds/store/backgroundStore").then(({ readActiveBackgroundId, setActiveBackgroundId, shouldKeepTemplateOverThemeBg }) => {
        // Respect the operator's most recent explicit choice: a template picked
        // more recently than the theme background stays (persists across restart);
        // otherwise the theme's own background wins and the template is cleared.
        if (readActiveBackgroundId() !== "none" && !shouldKeepTemplateOverThemeBg()) setActiveBackgroundId("none");
      });
    });
  }, [effectiveAppearance]);

  // Phase 2a — active live video input, emitted on OutputState so the output
  // windows open the feed. Restored from the Video Input panel's persisted
  // active selection on mount; the panel fires `presentflow:video-input-changed`
  // (same-machine, like theme/font-scale) on Activate/Clear/tweak.
  const [videoInput, setVideoInput] = useState<import("@/lib/broadcast").VideoInputState | null>(null);
  useEffect(() => {
    let mounted = true;
    (async () => {
      // Only restore an active video input on a shell that actually supports the
      // camera (0.1.135+). On an older shell the output window opening the camera
      // would crash, so we never emit videoInput there.
      const { shellSupportsCamera } = await import("@/lib/electron-version");
      if (!(await shellSupportsCamera()) || !mounted) return;
      try {
        const raw = window.localStorage.getItem("presentflow.videoInput.v1");
        if (!raw) return;
        const p = JSON.parse(raw) as import("@/lib/broadcast").VideoInputState & { active?: boolean };
        // Require a non-empty deviceId: an empty id (can be persisted pre-
        // permission) would emit an invalid videoInput and freeze the whole
        // OutputState on the projector.
        if (mounted && p?.active && typeof p.deviceId === "string" && p.deviceId.length > 0) {
          setVideoInput({ deviceId: p.deviceId, label: p.label, fit: p.fit, mirror: p.mirror, overlay: p.overlay });
        }
      } catch { /* no persisted video input */ }
    })();
    // The panel only fires this on a supported shell (it's gated), so the event
    // path needs no extra guard.
    const onChange = (e: Event) => setVideoInput((e as CustomEvent).detail?.videoInput ?? null);
    window.addEventListener("presentflow:video-input-changed", onChange);
    return () => { mounted = false; window.removeEventListener("presentflow:video-input-changed", onChange); };
  }, []);

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
  // OBS lower-third live config (2026-09-06). Mirrors the OBS setup card's saved
  // band so an edit in the card reaches the OBS overlay INSTANTLY over the output
  // channel. Read ONLY by /livestream — the projector/stage never read
  // `obsLowerThird`, so this can't change what they show. Seeded from the same
  // localStorage key the card writes; updated live via the card's window event.
  const [obsLowerThird, setObsLowerThird] = useState<ObsBandConfig | null>(null);
  // OBS EDITOR (2026-09-14): per-look settings + (once explicitly picked) the
  // look itself, published live as OutputState.obsLook. Read ONLY by /livestream.
  // Null until the new editor has saved anything → exactly the legacy snapshot.
  const [obsLook, setObsLook] = useState<ObsLookWire | null>(null);
  // Operator's own lower third (line1/line2) — held against the slide that was
  // live when it was sent: heartbeats / re-sends of that same slide keep it, and
  // it clears the moment a DIFFERENT slide goes live (production parity) or on an
  // explicit clear. Only /livestream renders it (band, full + camera looks).
  const [heldLowerThird, setHeldLowerThird] = useState<HeldLowerThird | null>(null);
  const opLowerThird = heldLowerThirdFor(heldLowerThird, liveSendSeq);
  useEffect(() => {
    if (heldLowerThird && heldLowerThird.sendSeq !== liveSendSeq) setHeldLowerThird(null);
  }, [liveSendSeq, heldLowerThird]);
  useEffect(() => {
    const read = () => {
      try {
        const v2 = localStorage.getItem(OBS_EDITOR_KEY);
        if (v2) {
          // Corrupt v2 JSON falls back to the legacy v1 band (not the default).
          const store = readObsEditorStore(v2, localStorage.getItem(LEGACY_BAND_KEY), localStorage.getItem(LEGACY_LOOK_KEY));
          setObsLowerThird(store.band);
          setObsLook(obsLookWireFromStore(store));
          return;
        }
        const raw = localStorage.getItem("presentflow.obs.lowerThird.v1");
        setObsLowerThird(raw ? clampObsBand(JSON.parse(raw)) : null);
        setObsLook(null);
      } catch { /* ignore */ }
    };
    read();
    const onEditor = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && typeof detail === "object") {
        try {
          const store = readObsEditorStore(JSON.stringify(detail), null, null);
          setObsLowerThird(store.band);
          setObsLook(obsLookWireFromStore(store));
        } catch { /* ignore */ }
      } else read();
    };
    window.addEventListener("presentflow:obs-editor-changed", onEditor);
    return () => {
      window.removeEventListener("presentflow:obs-editor-changed", onEditor);
    };
  }, []);
  // ── Decoupling Phase 3: operator layer store ──────────────────────────────
  // Gated on the global env kill-switch AND the per-church opt-in. When off,
  // the hook emits nothing and `overrides` is always [] → OutputState.layers is
  // never populated → projector output is byte-identical to the legacy path.
  const layersEngineOn = LAYERS_V2 && layersV2Prop;
  const emitLayerPatch = useCallback((msg: LiveMessage) => {
    if (msg.type !== "layer-patch") return;
    // Same-machine BroadcastChannel is the primary zero-latency path for a
    // single-layer swap. Remote surfaces (pair Realtime / LAN OBS) converge on
    // the same stack via the full OutputState.layers snapshot the main broadcast
    // effect fans out at ~1Hz (already scrubbed of local-scope layers) — so a
    // layer-patch stays a same-machine optimisation and never needs its own
    // remote wire shape. Preserves the "BroadcastChannel primary, Realtime
    // additive" invariant.
    safePost(chRef.current, msg);
  }, []);
  const liveLayers = useLiveLayers(
    { live, background: backgroundSpec, videoInput, appearance: effectiveAppearance },
    emitLayerPatch,
    layersEngineOn,
  );
  const layerOverrides = liveLayers.overrides;
  // R1b: a stable ref so sendSlideToLive (deps [churchId]) can re-arm the slide
  // layer on a successful send without taking liveLayers as a dependency.
  const liveLayersRef = useRef(liveLayers);
  liveLayersRef.current = liveLayers;

  const lastEmittedKeyRef = useRef<string>("");
  // Remote (Realtime + LAN) fan-out. Editor-only changes (obsLook /
  // obsLowerThird — slider drags) are coalesced to a trailing ≤~8/s with the
  // final value guaranteed; everything else (slides, theme, title) sends at once.
  // The same-machine BroadcastChannel post is NEVER throttled (rule 8).
  const lastRemoteNonObsKeyRef = useRef<string>("");
  const remotePublisherRef = useRef<ReturnType<typeof createTrailingPublisher<OutputState>> | null>(null);
  if (!remotePublisherRef.current) {
    remotePublisherRef.current = createTrailingPublisher<OutputState>((st) => {
      const remote = scrubOutputStateForRemote(st);
      if (rtRef.current) { void rtRef.current.publish(remote); }
      try {
        const lan = (typeof window !== "undefined" ? (window as unknown as { electronAPI?: { lan?: { publish: (s: unknown) => void } } }).electronAPI?.lan : undefined);
        if (lan) lan.publish(remote);
      } catch { /* ignore */ }
    }, 125);
  }
  useEffect(() => () => { try { remotePublisherRef.current?.dispose(); } catch { /* ignore */ } }, []);
  useEffect(() => {
    const fastMarker = fastTransitionSlideRef.current;
    const useFastTransition = fastMarker?.slide === live;
    // If another slide superseded the AI slide before this effect committed,
    // discard the stale one-shot marker so it cannot affect a later replay.
    if (!useFastTransition && fastMarker) fastTransitionSlideRef.current = null;
    const rawState: OutputState = {
      live,
      next: nextSlideForStage,
      itemTitle: plan.items[preview.itemIdx]?.title || "",
      slideNumber: `${preview.slideIdx + 1} / ${plan.items[preview.itemIdx]?.slides.length || 0}`,
      aspectRatio,
      fitMode,
      safeArea,
      operatorMessage: null,
      lowerThird: opLowerThird,
      countdownEndsAt,
      announcement,
      transition: useFastTransition ? fastMarker!.transition : transitionSpec,
      nextItem: nextItemForStage,
      fontScale: effectiveFontScale,
      referenceScale,
      referenceColor: referenceColor || undefined,
      background: backgroundSpec,
      appearance: effectiveAppearance,
      videoInput,
      zone: activeZone,
      // OBS lower-third config — inert for the projector/stage (they don't read
      // it); /livestream applies it live in its lower-third mode.
      obsLowerThird,
      // OBS editor look + settings — omitted until the editor saved something.
      ...(obsLook ? { obsLook } : {}),
      // Decoupling Phase 3: the operator's active layer-override patches. Empty
      // (and thus omitted below) unless the layers engine is on for this church,
      // so flag-off / no-patch churches emit exactly the legacy snapshot. Rides
      // the heartbeat so a late-joining projector converges to the same stack.
      layers: layerOverrides.length > 0 ? layerOverrides : undefined,
      // Y1b: announce this operator tab's origin epoch whenever the layers engine
      // is on — EVEN with no overrides — so a projector treats a fresh tab as
      // authoritative and clears any stale ghost-tab overrides (refresh-clears
      // invariant) without reopening the ghost-clobber. Omitted when the engine is
      // off, so flag-off churches emit exactly the legacy snapshot.
      layersEpoch: layersEngineOn ? liveLayers.epoch : undefined,
    };
    // PROJECTOR-RELIABILITY GUARANTEE (2026-09-06 field incident). Fail-open
    // sanitize the state before it goes on ANY wire (BroadcastChannel / Realtime /
    // LAN) so a single malformed neighbour field — most often the RAW `next` plan
    // slide (blob:/http: media object, named colour, off-canvas coord) — can never
    // make isValidOutputState reject the whole snapshot on the projector and leave
    // a reconnecting screen BLACK. Drops only the bad SUBFIELD; the live slide +
    // theme + background always project. Never null in practice (live is a real
    // SlidePayload); fall back to raw if it ever were.
    const state: OutputState = sanitizeOutputState(rawState) ?? rawState;
    // Shallow signature — good enough for the fields we actually emit.
    let key: string;
    try { key = `${JSON.stringify(state)}:${liveBroadcastRevision}`; } catch { key = String(Math.random()); }
    if (key === lastEmittedKeyRef.current) return;
    lastEmittedKeyRef.current = key;
    lastOutputStateRef.current = state; // cached for snapshot-on-join replay
    safePost(chRef.current, { type: "output", state });
    // videoInput.deviceId only means something on THIS machine (the camera is
    // physically here), so it goes over same-machine BroadcastChannel only —
    // never Realtime. A cross-device surface can't open a local camera id, and
    // this prevents a paired frame from activating a default camera on a public
    // livestream (security).
    // LAN OVERLAY fan-out (desktop only) rides the same publisher — mirrors the
    // full OutputState to the local http+ws server so an OBS Browser Source on a
    // SEPARATE broadcast PC gets lyrics over the LAN with no cloud dependency.
    // Same videoInput scrub as Realtime (see remotePublisherRef).
    {
      let nonObsKey: string;
      try { const { obsLook: _l, obsLowerThird: _b, ...rest } = state; void _l; void _b; nonObsKey = `${JSON.stringify(rest)}:${liveBroadcastRevision}`; } catch { nonObsKey = String(Math.random()); }
      const editorOnly = nonObsKey === lastRemoteNonObsKeyRef.current;
      lastRemoteNonObsKeyRef.current = nonObsKey;
      if (editorOnly) remotePublisherRef.current!.schedule(state);
      else remotePublisherRef.current!.sendNow(state);
    }
    // Same-window editor preview — AFTER every projector/remote post.
    publishObsPreviewState(state);
    // CUT-THEN-FLOAT FIX (2026-08-20): do NOT clear the marker here. It used to
    // be one-shot, so the NEXT OutputState re-post for the SAME instant slide
    // (1 Hz heartbeat / any dep change) fell through to `transitionSpec` and
    // leaked the operator's fade onto a verse that was already hard-cut — the
    // "boom project, then float" glitch. The marker now stays STICKY while this
    // exact slide is live (every re-post carries transition:null); the stale-
    // marker cleanup at the top of this effect clears it the moment `live`
    // changes to a different slide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, liveBroadcastRevision, preview.itemIdx, preview.slideIdx, aspectRatio, fitMode, safeArea, plan.items, countdownEndsAt, announcement, transitionSpec, fontScale, effectiveAppearance, videoInput, effectiveFontScale, referenceScale, referenceColor, backgroundSpec, activeZone, obsLowerThird, obsLook, opLowerThird, layerOverrides]);
  const chRef = useRef<LiveChannelLike | null>(null);
  const liveRef = useRef<SlidePayload>(live);
  liveRef.current = live;
  type LivePos = { itemIdx: number; slideIdx: number };
  /** Record a live send for the title key (see liveSendSeq). */
  const noteLiveSend = useCallback((slide: SlidePayload, pos?: LivePos | null) => {
    const posKey = pos ? `${pos.itemIdx}:${pos.slideIdx}` : null;
    let idChanged = true;
    try { idChanged = slideOutputIdentity(slide) !== slideOutputIdentity(liveRef.current); } catch { /* treat as changed */ }
    const changed = idChanged || (posKey !== null && posKey !== livePosRef.current);
    if (posKey !== null || idChanged) livePosRef.current = posKey;
    if (changed) { liveSendSeqRef.current += 1; setLiveSendSeq(liveSendSeqRef.current); }
  }, []);
  const setLive = useCallback((slide: SlidePayload, pos?: LivePos | null) => {
    noteLiveSend(slide, pos);
    setLiveRaw(slide);
  }, [noteLiveSend]);
  // The PRE-layout source of whatever is currently live — captured at
  // sendSlideToLive entry (before applyChurchLayout). Re-sending THIS through the
  // pipeline re-applies the CURRENT church layout, so a full↔third toggle can
  // update the slide already on screen (not just the next one).
  const lastSourceRef = useRef<SlidePayload | null>(null);
  // Output identity of the STYLED slide committed together with lastSourceRef.
  // un-blank / reapplyLayoutToLive only trust lastSourceRef when this still equals
  // the identity of what is actually live; otherwise (a send path that didn't
  // record a source — undo/redo, a future caller) they fall back to reducing the
  // CURRENT live slide via sourceForRelayout, so they can never restore a stale slide.
  const lastSourceLiveIdRef = useRef<string | null>(null);
  // LIVE ORIGIN (song auto-switch guard, rule 7 positive-evidence revision
  // 2026-09-14): what KIND of content the current live output is, stamped at
  // every local send path together with the styled slide's output identity.
  // getLiveOrigin only trusts it while that identity is still what is live, so
  // a slide set by another device / an unstamped path reads as UNKNOWN (→ the
  // guard allows). originByIdRef remembers declared origins per identity so
  // undo/redo, un-blank and layout re-sends keep a song attributed as a song.
  const liveOriginRef = useRef<{ origin: LiveOrigin; identity: string } | null>(null);
  const originByIdRef = useRef<Map<string, LiveOrigin>>(new Map());
  const planItemsRef = useRef(plan.items);
  planItemsRef.current = plan.items;
  const stampLiveOrigin = useCallback((source: SlidePayload, styled: SlidePayload, declared?: LiveOrigin, carry?: boolean) => {
    const identity = slideOutputIdentity(styled);
    // Origin of what is on the projector BEFORE this send (only while still valid).
    let priorOrigin: LiveOrigin | null = null;
    try {
      const r = liveOriginRef.current;
      priorOrigin = r && r.identity === slideOutputIdentity(liveRef.current) ? r.origin : null;
    } catch { priorOrigin = null; }
    if (styled.kind === "blank" || styled.kind === "empty" || styled.kind === "logo") {
      liveOriginRef.current = { origin: { kind: "other" }, identity };
      return;
    }
    // Resolution order for a send (2026-09-14 gate): declared → carried SONG
    // origin of the slide being re-sent (explicit carry or unchanged text) →
    // plan lookup → per-identity memory → inference. Carry/plan run BEFORE the
    // memory so a shared line ("Hallelujah") remembered for song B cannot shadow
    // song A that is actually live.
    let origin: LiveOrigin | undefined = declared;
    let carried = false;
    if (!origin) {
      origin = carriedOrigin(priorOrigin, styled as { kind: string; text?: string }, carry);
      carried = !!origin;
    }
    if (!origin && styled.kind === "text") {
      // Resolve against the plan: a slide belonging to a plan item inherits its
      // type (song items carry songId). Two different songs sharing the line →
      // song with unknown id (conservative, the guard holds).
      const srcId = slideOutputIdentity(source);
      let found: LiveOrigin | undefined;
      for (const it of planItemsRef.current) {
        const hit = it.slides.some((ps) => {
          if (ps.kind !== "text") return false;
          const pid = slideOutputIdentity(ps);
          if (pid === srcId || pid === identity) return true;
          try { return slideOutputIdentity(applyChurchLayout(ps, churchId)) === identity; } catch { return false; }
        });
        if (!hit) continue;
        const itType = (it as { type?: string }).type;
        const songId = (it as { songId?: string }).songId;
        const next: LiveOrigin = itType === "song" ? { kind: "song", songId } : itType === "scripture" ? { kind: "scripture" } : { kind: "text" };
        if (!found) { found = next; continue; }
        if (found.kind === "song" && next.kind === "song" && found.songId !== next.songId) found = { kind: "song" };
        else if (next.kind === "song" && found.kind !== "song") found = next;
      }
      origin = found;
    }
    if (!origin) origin = recallOrigin(originByIdRef.current, identity);
    origin = origin ?? { ...inferLiveOrigin(styled), inferred: true };
    if (declared) rememberOrigin(originByIdRef.current, identity, declared);
    else if (carried && origin.kind === "song") rememberOrigin(originByIdRef.current, identity, origin);
    liveOriginRef.current = { origin, identity };
  }, [churchId]);
  // Origin recorded for a given live payload (null = unknown / not stamped here).
  const originOf = useCallback((slide: SlidePayload): LiveOrigin | null => {
    const r = liveOriginRef.current;
    if (!r) return null;
    try { return r.identity === slideOutputIdentity(slide) ? r.origin : null; } catch { return null; }
  }, []);
  const getLiveOrigin = useCallback((): LiveOrigin | null => {
    const r = liveOriginRef.current;
    if (!r) return null;
    try { return r.identity === slideOutputIdentity(liveRef.current) ? r.origin : null; } catch { return null; }
  }, []);

  // Networked projector sync: when a pair code is minted the operator's
  // OutputState is ALSO published on the Supabase Realtime channel scoped by
  // that code. BroadcastChannel (same-machine) remains the primary low-latency
  // path — this is strictly additive fan-out.
  const rtRef = useRef<ReturnType<typeof openOutputChannel> | null>(null);
  const lastOutputStateRef = useRef<OutputState | null>(null);
  const [pairCode, setPairCode] = useState<string | null>(null);
  // Real church id (was read off `plan`, which never carries it → always "" →
  // the church-scoping of the Realtime output channel silently never engaged).
  // realtime.ts subscribes to BOTH scoped and unscoped channel names, so
  // activating the scope is compatible with any already-paired projector.
  const churchIdForChannel = churchId;
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
  // Desktop OBS overlay: SyncControl (the web pair-code UI) doesn't render on
  // desktop (it collides with the toolbar), so the desktop OBS card in
  // Hardware→Screens mints its code and announces it via this window event. We
  // set pairCode → the effect above opens the Realtime publisher, so the OBS
  // Browser Source actually receives live state. Payload: { code } or { code:null }.
  useEffect(() => {
    const onObsPair = (e: Event) => {
      const detail = (e as CustomEvent<{ code: string | null }>).detail;
      setPairCode(detail && typeof detail.code === "string" ? detail.code : null);
    };
    window.addEventListener("presentflow:obs-pair-code", onObsPair as EventListener);
    // Resume publishing after an app reload WITHOUT needing the operator to open
    // the Screens panel (ObsOverlayCard, and its restore effect, are mounted
    // lazily). Restore a still-valid persisted OBS code here, on the always-mounted
    // console, so the OBS Browser Source keeps receiving after a restart.
    try {
      const c = localStorage.getItem("presentflow.obs.pairCode");
      const exp = localStorage.getItem("presentflow.obs.pairExpiresAt");
      if (c && exp && Number(exp) > Date.now()) setPairCode(c);
    } catch { /* ignore */ }
    return () => window.removeEventListener("presentflow:obs-pair-code", onObsPair as EventListener);
  }, []);

  // Phase 5A: local song library for client-side lyric/title matching.
  // The live song detector matches spoken lyrics against THIS library, so it
  // must stay current with imports. Previously this fetched once on mount and
  // never again — so lyrics imported mid-session (CCLI or the public-domain
  // hymn flow) were invisible to detection until a full app reload, which
  // reads as "song detection doesn't pick up." Now it refetches on the events
  // that actually follow an import, and only commits (triggering the index
  // rebuild in useAudioStream) when the set materially changed — a cheap
  // signature over id + slide-count avoids needless index churn on every poll.
  const [songLibrary, setSongLibrary] = useState<IndexedSong[]>([]);
  const songLibSigRef = useRef<string>("");
  useEffect(() => {
    let cancelled = false;
    // Signature must change on ANY lyric change, not just slide-count changes —
    // an in-place edit (typo fix / rewrite) keeps the slide count but must
    // still re-index, so fold a cheap content digest of the lyrics into it.
    const digest = (s: IndexedSong) => {
      let h = 5381;
      for (const sl of s.slides ?? []) {
        const t = sl.lyrics ?? "";
        for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0;
      }
      return h;
    };
    const sig = (songs: IndexedSong[]) =>
      songs.map((s) => `${s.songId}:${s.slides?.length ?? 0}:${digest(s)}`).sort().join("|");
    const load = () => {
      fetch("/api/songs/library").then((r) => r.json()).then((res) => {
        if (cancelled || !Array.isArray(res.songs)) return;
        const next = res.songs as IndexedSong[];
        const nextSig = sig(next);
        if (nextSig === songLibSigRef.current) return; // unchanged — skip rebuild
        songLibSigRef.current = nextSig;
        setSongLibrary(next);
      }).catch(() => { /* non-fatal */ });
    };
    load();
    // Refetch when the operator returns focus (imported in another window) and
    // when the app fires an explicit "songs changed" signal after an import.
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    const onSongsChanged = () => load();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("presentflow:songs-changed", onSongsChanged);
    // Safety-net poll (gentle): catches an in-app import that didn't fire the
    // event. The signature guard above means an unchanged library never churns
    // the detection index.
    const iv = window.setInterval(load, 90_000);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("presentflow:songs-changed", onSongsChanged);
      window.clearInterval(iv);
    };
  }, []);

  // Playlist song IDs — for the "in-playlist" confidence boost.
  const planSongIds = useMemo(() => plan.items.map((it) => (it as unknown as { songId?: string }).songId).filter(Boolean) as string[], [plan.items]);

  const getDetectContext = useCallback(() => ({
    churchId,
    planId: plan.id,
    planSongIds,
    recentSongIds: [] as string[],
    // Service-mode bias (Worship / Preacher / Auto). Read from a ref so the
    // latest operator choice is seen on every detection without re-creating the
    // audio hook. "auto" (default) makes this a no-op in detectAll.
    mode: serviceModeRef.current,
    hasVerseContext: false,
    hasSlideContext: true, // always assume some slide context in operator
    hasSongContext: false, // updated below via ref
  }), [plan.id, planSongIds, plan, churchId]);

  const { state: audio, start: startAudio, stop: stopAudio, resume: resumeAudio, restart: restartAudio, warmStart: warmStartAudio, dismissDetection, dismissSong, dismissCommand, dismissSuggestion, simulateTranscript, multiChannelCapture, currentDeviceId } = useAudioStream(plan.id, {
    library: songLibrary,
    getDetectContext,
  });

  // Feed the AI pipeline's health into the unified connection-health store so
  // the graceful-degradation banner + (later) offline data layer can react.
  // A give-up (reconnectFailed) is AI "down" → MANUAL MODE; an in-flight
  // reconnect stays "reconnecting" (no scary banner for a 2s blip).
  useEffect(() => {
    const aiHealth = audio.reconnectFailed
      ? "down"
      : audio.listening
        ? (audio.ready ? "live" : "reconnecting")
        : "idle";
    setAiHealth(aiHealth);
  }, [audio.reconnectFailed, audio.listening, audio.ready]);

  // Background Supabase-reachability poll → DATA_DEGRADED when it can't be
  // reached even though the internet is up. Ref-counted; stops on unmount.
  useEffect(() => startDataHealthPolling(), []);

  // Offline resilience: idle-time, download every public-domain translation so
  // ANY verse projects with no network (licensed are cached on-demand instead).
  // Resumable — re-runs when the AI listener flips OFF so it hydrates during
  // setup/after a service, and defers (isBusy) while a service is live so it
  // never janks a verse projection. No-ops offline / once fully hydrated.
  const listeningRef = useRef(audio.listening);
  listeningRef.current = audio.listening;
  useEffect(() => {
    hydratePublicDomainBibleInBackground(() => listeningRef.current);
  }, [audio.listening]);

  // (REMOVED 2026-08-20) A stale effect here used to force-stop the audio stream
  // whenever autopilotMode === "manual". It contradicted the 2026-08-14
  // decoupling (AI listening is INDEPENDENT of AUTO/MANUAL — manual only gates
  // auto-PROJECTION, not the mic) and made the AI on/off toggle unusable in
  // manual mode: clicking ON flipped `listening:true`, which re-ran this effect
  // and immediately stopped it, so the pill blinked ON→OFF and the operator
  // "couldn't turn AI on at will". Manual mode already gates auto-projection via
  // `autoApprove.enabled = autopilotMode === "active"` below, so no stream
  // teardown is needed. The AI toggle is now purely intent-driven.

  // 2026-07-25 Bug-3: resume listening on load if AI was ON when the operator
  // last used the console (intent persisted in onListenToggle below). The
  // tester expectation: open the app → AI is already listening, no manual
  // re-arm every session. Mic permission is already granted on a machine
  // that's used the listener before, so getUserMedia won't prompt; if the
  // start fails (revoked permission, device gone), useAudioStream surfaces
  // its normal error state — same as a manual toggle failing.
  const aiAutoStartTriedRef = useRef(false);
  // Latest audio state for the deferred auto-start check below — the mount
  // effect's closure would otherwise see the initial (pre-warmStart) state.
  const audioLatestRef = useRef(audio);
  useEffect(() => { audioLatestRef.current = audio; });
  useEffect(() => {
    if (aiAutoStartTriedRef.current) return;
    try {
      // AI listening is independent of the AUTO/MANUAL autopilot toggle
      // (manual only gates auto-PROJECT, not the mic). The intent key is the
      // single source of truth: if the operator explicitly turned AI ON, resume
      // it on reload/relaunch in EITHER mode (2026-08-14 — was skipped in manual,
      // so AI didn't persist for manual-mode operators). The 600ms defer +
      // warmStart/resume path below still avoids the mic-flap the mode gate was
      // added for; the visible toast covers the surprise-hot-mic case.
      if (window.localStorage.getItem(AI_LISTEN_INTENT_KEY) !== "1") return;
    } catch { return; }
    // Reviewer 🟡 fix: defer past the shell's warm-start effect and prefer
    // resume() over a second cold start() when the pipeline is already warm
    // (avoids churning the mic + a wasted ticket fetch on every launch).
    const t = window.setTimeout(() => {
      // Marked tried at FIRE time (not schedule time) so a StrictMode
      // dev double-mount's cancelled first timer doesn't burn the one-shot.
      if (aiAutoStartTriedRef.current) return;
      aiAutoStartTriedRef.current = true;
      const a = audioLatestRef.current;
      if (a.listening) return;
      const kick = a.warmStarted ? Promise.resolve(resumeAudio()) : startAudio();
      Promise.resolve(kick)
        .then(() => {
          // Surprise-hot-mic guard (security review 🟡): make the auto-resume
          // visible so an operator who forgot AI was armed notices immediately.
          toast.info("AI listening auto-resumed from your last session — toggle AI OFF in the top bar to stop.");
        })
        .catch(() => { /* error surfaced via audio.error */ });
    }, 600);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // JPD Fix 5: persist the operator's position (debounced 2s in the lib,
  // flushed on pagehide/visibilitychange so quitting the app can't lose the
  // last change). `aiWasOn` is a mirror only — AI auto-resume stays with the
  // existing AI_LISTEN_INTENT_KEY path (Bug-3 above).
  useEffect(() => {
    updateSessionState({
      lastActiveItemIdx: preview.itemIdx,
      lastActiveSlideIdx: preview.slideIdx,
      aiWasOn: audio.listening,
      activePlanId: plan.id,
    });
  }, [preview.itemIdx, preview.slideIdx, audio.listening, plan.id]);

  // Verse bank: per-service history of approved refs + ±5 preload window
  const { bank, currentRef: currentBankRef, addReference: bankAdd, advanceOne: bankAdvance, jumpTo: bankJumpTo, clear: bankClear, bankedToSlide } = useVerseBank(defaultTranslationCode);
  // Bible-panel handlers (Bible redesign)
  const [hiddenBankIds, setHiddenBankIds] = useState<Set<string>>(new Set());
  const effectiveBank = useMemo(() => bank.filter((b) => !hiddenBankIds.has(b.id)), [bank, hiddenBankIds]);
  const sendSlideToLive = useCallback((
    slide: SlidePayload,
    spec?: import("@/lib/broadcast").TransitionSpec | null,
    options?: { preserveConfiguredTransition?: boolean; instant?: boolean; force?: boolean; origin?: LiveOrigin; carryLiveOrigin?: boolean; position?: LivePos },
  ) => {
    // 2026-07-25 — added tracing + defensive guards after a field report
    // that "clicking a song slide does nothing" (v0.1.42 hunt). The pipeline
    // is unified for songs and Bible verses so a shape-specific bug is the
    // most likely cause; log the incoming payload so any silent invalidation
    // surfaces in DevTools instead of being swallowed.
    try { console.log("[live] sendSlideToLive fired", { kind: slide?.kind, textLen: slide && "text" in slide ? slide.text?.length : undefined, hasChannel: !!chRef.current }); } catch { /* ignore */ }
    if (!slide || typeof slide !== "object" || !("kind" in slide)) {
      console.warn("[live] sendSlideToLive got invalid slide payload — no-op", slide);
      return;
    }
    // CENTRAL LAYOUT (2026-08-25 scripture preview≠live fix, generalized 2026-09-04):
    // apply the church's saved projection layout to EVERY send so the projector
    // matches the styled preview AND "set the layout once → applies to everything"
    // holds. Scripture keeps full styling; songs/plain text get confined into the
    // church's lower-third band when that's the saved default (else unchanged);
    // a per-slide layout override wins; media is untouched. See applyChurchLayout.
    // Runs BEFORE the identity checks so all downstream guards see the final slide.
    lastSourceRef.current = slide; // remember the pre-layout source (for a live toggle)
    const originSource = slide;
    slide = applyChurchLayout(slide, churchId);
    lastSourceLiveIdRef.current = slideOutputIdentity(slide);
    // Record what KIND of content this is for the song auto-switch guard. On the
    // already-live skip below the identity is unchanged, so a re-stamp only ever
    // refines the origin (a declared song origin wins over an inferred one).
    if (options?.origin || slideOutputIdentity(slide) !== slideOutputIdentity(liveRef.current) || options?.force) {
      stampLiveOrigin(originSource, slide, options?.origin, options?.carryLiveOrigin);
    }
    // ALREADY-LIVE SKIP (2026-08-20): if this EXACT slide is already on the
    // projector, sending it again is a no-op — do nothing. Re-clicking the live
    // verse card, or the preacher repeating the verse that's on screen, used to
    // re-fire the whole pipeline (revision bump + set/output re-post) and glitch/
    // re-transition. The manual card-click instant path bypassed every AI guard
    // and safeSendLive's identical-slide skip; this covers ALL callers centrally.
    // `force` bypasses the already-live skip: the scripture/slide editor's
    // explicit "Show" must re-project even when only style fields (align, size,
    // weight, uppercase…) changed — those aren't part of slideOutputIdentity, so
    // without this a re-show of the "same" verse is silently a no-op.
    if (!options?.force && slideOutputIdentity(slide) === slideOutputIdentity(liveRef.current)) {
      // Projector untouched, but same content from a DIFFERENT deck position is a
      // new send for the operator title (it clears).
      if (options?.position) noteLiveSend(slide, options.position);
      return;
    }
    if (options?.instant) {
      // instant: true — bypass all transition animation for this slide.
      // Sends transition:null in the "set" message so the projector clears its
      // cached transition immediately (before the output-effect fires), and also
      // marks fastTransitionSlideRef so the subsequent "output" message also
      // carries transition:null. Used for Bible verse card clicks where a 1-2 s
      // theme fade is user-visible latency.
      fastTransitionSlideRef.current = { slide, transition: null };
      setLive(slide, options?.position);
      setLiveBroadcastRevision((revision) => revision + 1);
      chRef.current?.postMessage({ type: "set", slide, transition: null } as LiveMessage);
      liveLayersRef.current.rearmSlide(); // R1b: a real new slide re-arms the slide layer
      return;
    }
    // Transition the "set" message and the follow-up "output" message will
    // carry. AI auto-fires (preserveConfiguredTransition) animate with the fast
    // AI_AUTO_TRANSITION — smooth but latency-safe — while leaving the operator's
    // configured `transitionSpec` untouched for subsequent manual sends.
    let setTransition: import("@/lib/broadcast").TransitionSpec | null | undefined;
    if (options?.preserveConfiguredTransition) {
      fastTransitionSlideRef.current = { slide, transition: AI_AUTO_TRANSITION };
      setTransition = AI_AUTO_TRANSITION;
    } else {
      if (spec !== undefined) setTransitionSpec(spec);
      setTransition = spec;
    }
    setLive(slide, options?.position);
    // A repeated reference can reuse the exact same slide object. Force the
    // networked OutputState effect to republish even when React bails out of
    // the identical setLive value.
    setLiveBroadcastRevision((revision) => revision + 1);
    const posted = chRef.current?.postMessage({
      type: "set",
      slide,
      ...(setTransition !== undefined ? { transition: setTransition } : {}),
    } as LiveMessage);
    liveLayersRef.current.rearmSlide(); // R1b: a real new slide re-arms the slide layer
    try { console.log("[live] setLive committed + broadcast posted", { posted: posted !== undefined ? "ok" : "no-channel" }); } catch { /* ignore */ }
  }, [churchId, stampLiveOrigin, noteLiveSend, setLive]);
  const stageSlide = useCallback((slide: SlidePayload) => setStagedAISlide(slide), []);
  // Direct (no-transition) send paths — send(), move autoSend, jumpTo, banked,
  // legacy voice nav — used to skip applyChurchLayout, so with a lower-third
  // church default they projected FULL screen while click/Enter banded. Route
  // them through the same layout + source bookkeeping. applyChurchLayout is
  // idempotent on already-styled slides (no double-apply) and returns blank/logo/
  // empty unchanged; the "set" post is unchanged (still an instant hard cut).
  const layoutForDirectSend = useCallback((slide: SlidePayload): SlidePayload => {
    const styled = applyChurchLayout(slide, churchId);
    lastSourceRef.current = slide;
    lastSourceLiveIdRef.current = slideOutputIdentity(styled);
    stampLiveOrigin(slide, styled); // every direct send path records its origin too
    return styled;
  }, [churchId, stampLiveOrigin]);
  const sendBankedToLive = useCallback((idx: number) => {
    const v = effectiveBank[idx];
    if (!v) return;
    const slide = layoutForDirectSend(bankedToSlide(v));
    setLive(slide);
    chRef.current?.postMessage({ type: "set", slide } as LiveMessage);
  }, [effectiveBank, bankedToSlide, layoutForDirectSend]);
  const removeBanked = useCallback((idx: number) => {
    const v = effectiveBank[idx];
    if (!v) return;
    setHiddenBankIds((cur) => { const n = new Set(cur); n.add(v.id); return n; });
  }, [effectiveBank]);
  const processedSegments = useRef<Set<string>>(new Set()); // dedupe context-cmd firing
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
      if (msg.type === "ping") {
        // Answer EVERY heartbeat (and join) with the full OutputState snapshot,
        // not the slide-only pong. The projector's theme/background/appearance
        // ONLY ride the "output" message; every live-FIRE uses the lighter "set"
        // message and the "output" post is deduped, so on a flaky cross-window
        // BroadcastChannel (the projector has no IPC-relay preload) a dropped
        // "output" leaves the theme missing for the whole service with no
        // recovery (2026-08-28 field bug: yellow lyrics on a WHITE projector
        // while the app preview shows the themed background). Re-sending the full
        // snapshot every ~3s self-heals it. The 2026-08-21 "re-renders ~1×/sec"
        // regression is now prevented on the RECEIVER: /live dedupes the
        // non-slide fields by signature and applyLive dedupes the slide, so an
        // unchanged snapshot is a no-op. Fall back to the slide-only pong only
        // when no snapshot exists yet (nothing has gone live).
        const snap = lastOutputStateRef.current;
        if (snap) ch.postMessage({ type: "output", state: snap } as LiveMessage);
        else ch.postMessage({ type: "pong", slide: liveRef.current } as LiveMessage);
      }
    };
    return () => { ch.close(); chRef.current = null; };
  }, []);

  const send = useCallback((raw: SlidePayload, pos?: LivePos) => {
    const slide = layoutForDirectSend(raw);
    setLive(slide, pos);
    chRef.current?.postMessage({ type: "set", slide } as LiveMessage);
  }, [layoutForDirectSend, setLive]);

  const clearLive = useCallback(() => {
    liveOriginRef.current = { origin: { kind: "other" }, identity: slideOutputIdentity({ kind: "empty" }) };
    setLive({ kind: "empty" });
    chRef.current?.postMessage({ type: "clear" } as LiveMessage);
  }, []);

  // Record projector history on every real change to `live` (skips the change
  // that undo/redo itself caused). A new projection clears the redo branch.
  useEffect(() => {
    if (liveUndoRedoInFlightRef.current) {
      liveUndoRedoInFlightRef.current = false;
      livePrevRef.current = live;
      livePrevOriginRef.current = originOf(live);
      return;
    }
    const prev = livePrevRef.current;
    let changed = true;
    try { changed = JSON.stringify(prev) !== JSON.stringify(live); } catch { /* keep true */ }
    if (changed) {
      liveUndoStackRef.current.push({ slide: prev, origin: livePrevOriginRef.current });
      if (liveUndoStackRef.current.length > 60) liveUndoStackRef.current.shift();
      liveRedoStackRef.current = [];
      setLiveHistoryVer((v) => v + 1);
    }
    livePrevRef.current = live;
    livePrevOriginRef.current = originOf(live);
  }, [live, originOf]);

  // Re-project a payload from history WITHOUT recording it as a new action
  // (instant cut — undo/redo should be immediate, no transition).
  const reprojectFromHistory = useCallback((entry: LiveHistoryEntry) => {
    const slide = entry.slide;
    liveUndoRedoInFlightRef.current = true;
    if (slide.kind === "empty") { clearLive(); }
    else sendSlideToLive(slide, null, { instant: true, origin: entry.origin && !entry.origin.inferred ? entry.origin : undefined });
  }, [sendSlideToLive, clearLive]);

  // Short human label for what a history slide is, for the undo/redo toast so the
  // operator gets a clear confirmation of what's now on the projector.
  const liveSnippet = useCallback((s: SlidePayload): string => {
    if (s.kind === "empty") return "cleared screen";
    if (s.kind === "blank") return "blank screen";
    if (s.kind === "logo") return "logo";
    if (s.kind === "image") return "an image";
    if (s.kind === "video") return "a video";
    const t = (s.text ?? "").trim();
    if (!t) return "a slide";
    const lastLine = t.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "";
    // Bible slides end with "Book C:V (CODE)" — show that; else the first words.
    if (/\d+:\d+/.test(lastLine)) return lastLine;
    return t.slice(0, 42) + (t.length > 42 ? "…" : "");
  }, []);

  const undoLive = useCallback(() => {
    const target = liveUndoStackRef.current.pop();
    if (target === undefined) { toast("Nothing to undo on the projector"); return; }
    liveRedoStackRef.current.push({ slide: livePrevRef.current, origin: livePrevOriginRef.current });
    reprojectFromHistory(target);
    setLiveHistoryVer((v) => v + 1);
    toast.success(`↶ Projector reverted to: ${liveSnippet(target.slide)}`, { duration: 2200 });
  }, [reprojectFromHistory, liveSnippet]);

  const redoLive = useCallback(() => {
    const target = liveRedoStackRef.current.pop();
    if (target === undefined) { toast("Nothing to redo on the projector"); return; }
    liveUndoStackRef.current.push({ slide: livePrevRef.current, origin: livePrevOriginRef.current });
    reprojectFromHistory(target);
    setLiveHistoryVer((v) => v + 1);
    toast.success(`↷ Projector moved forward to: ${liveSnippet(target.slide)}`, { duration: 2200 });
  }, [reprojectFromHistory, liveSnippet]);

  // Blank is a TOGGLE (2026-08-29 fix — it used to only ever blank, so the
  // "Unblank" button/B-key left the projector black with no way back except
  // re-clicking a slide). Remember the slide that was live when we blank, and
  // restore it when the operator un-blanks.
  const prevBeforeBlankRef = useRef<SlidePayload | null>(null);
  const prevBeforeBlankOriginRef = useRef<LiveOrigin | null>(null);
  // The pre-layout source of what's ACTUALLY live: lastSourceRef when its
  // committed identity still matches the live slide, else the live slide reduced
  // to raw content (never a stale earlier slide).
  const currentLiveSource = useCallback((cur: SlidePayload): SlidePayload => {
    const src = lastSourceRef.current;
    if (src && lastSourceLiveIdRef.current !== null && lastSourceLiveIdRef.current === slideOutputIdentity(cur)) return src;
    return sourceForRelayout(cur);
  }, []);
  const goBlank = useCallback(() => {
    const cur = liveRef.current;
    const isBlank = cur?.kind === "blank" || cur?.kind === "empty";
    const prev = prevBeforeBlankRef.current;
    if (isBlank && prev && prev.kind !== "blank" && prev.kind !== "empty") {
      sendSlideToLive(prev, undefined, { instant: true, force: true, origin: prevBeforeBlankOriginRef.current && !prevBeforeBlankOriginRef.current.inferred ? prevBeforeBlankOriginRef.current : undefined }); // un-blank replays the recorded origin
      return;
    }
    // Remember the PRE-layout SOURCE (not the already-styled live slide) so
    // un-blank re-runs the CURRENT layout — and so a layout toggle after un-blank
    // can still reverse it (re-sending a styled slide would no-op in
    // applyChurchLayout). Falls back to the live slide if no source was captured.
    if (cur && cur.kind !== "blank" && cur.kind !== "empty") { prevBeforeBlankRef.current = currentLiveSource(cur); prevBeforeBlankOriginRef.current = getLiveOrigin(); }
    send({ kind: "blank", bgColor: plan.blankBgColor });
  }, [plan.blankBgColor, send, sendSlideToLive, currentLiveSource, getLiveOrigin]);
  const goLogo = useCallback(() => send({ kind: "logo", url: plan.logoUrl }), [plan.logoUrl, send]);

  // Use sendSlideToLive with instant:true so the LIVE button is always zero-latency.
  // The fade/dissolve transition is intentional for playlist slides, but when an
  // operator explicitly presses LIVE they want it NOW — no 1-2 s animation delay.
  // Phase 4 — the ONE action dispatcher seam. A stable wrapper around the engine
  // `dispatchAction(ctx, action, opts)` bound to the LIVE ctx via a ref (the ctx
  // is assembled below and the ref is refreshed each render, so the wrapper
  // itself is stable — no dep churn — while always dispatching against the
  // current handlers).
  const ctxRef = useRef<OperatorShellCtx | null>(null);
  const dispatchEngineAction = useCallback(
    (action: EngineAction, opts?: { confirmed?: boolean }): DispatchResult => {
      const c = ctxRef.current;
      if (!c) return { handled: false, reason: "unknown" };
      return dispatchAction(c, action, opts);
    },
    [],
  );
  // Phase 4 — real handler behind SET_BACKGROUND_MEDIA: route a media asset
  // through the setMediaAsBackground store machinery (Wave 4). Client-only side
  // effect; safe here (OperatorConsole is a client component).
  const setBackgroundMedia = useCallback(
    (assetRef: { id: string; url: string; fileName: string; kind: string; mediaKey?: string }) => {
      setMediaAsBackground({
        id: assetRef.id,
        url: assetRef.url,
        fileName: assetRef.fileName,
        kind: normalizeMediaKind(assetRef.kind),
        mediaKey: assetRef.mediaKey,
      });
    },
    [],
  );

  // Phase 4 — church Automations (macros) cache, for resolving a slide action of
  // type "macro". Loaded once; refreshed by the Automations panel via event.
  const macrosRef = useRef<MacroDefinition[]>([]);
  // true only once listMacros actually succeeded. While false (still loading,
  // failed, or refused for a role without operate_services) a macro slide
  // action can't be judged "missing", so it's skipped silently — no toast.
  const macrosLoadedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { listMacros } = await import("@/lib/actions");
        const res = await listMacros();
        if (cancelled) return;
        if (res.ok && res.data) {
          macrosRef.current = res.data.map((m) => ({ id: m.id, churchId, name: m.name, actions: m.actions as MacroDefinition["actions"], enabled: m.enabled }));
          macrosLoadedRef.current = true;
        } else {
          macrosLoadedRef.current = false;
        }
      } catch { if (!cancelled) macrosLoadedRef.current = false; /* macros are optional */ }
    };
    void load();
    const onChanged = () => { void load(); };
    window.addEventListener("presentflow:macros-changed", onChanged);
    return () => { cancelled = true; window.removeEventListener("presentflow:macros-changed", onChanged); };
  }, [churchId]);

  // Phase 4 — fire a slide's attached actions through the ONE dispatcher when the
  // operator sends that slide live. Slide actions are validated NON-destructive
  // (sanitize drops any guarded spec) and dispatched confirmed:false, so this can
  // never blank/kill the projector. Operator-initiated ONLY (see sendPreview);
  // AI auto-fire paths deliberately do NOT fire slide actions (strictly-safe,
  // no-regression — documented in DECOUPLING_PLAN §Phase 4).
  const fireSlideActions = useCallback((itemIdx: number, slideIdx: number) => {
    const raw = plan.items[itemIdx]?.slideActions?.[slideIdx];
    if (!Array.isArray(raw) || raw.length === 0) return;
    const specs = sanitizeSlideActions(raw);
    if (specs.length === 0) return;
    const outcomes = dispatchSlideActions(
      dispatchEngineAction,
      specs,
      (macroId) => {
        const def = macrosRef.current.find((m) => m.id === macroId);
        return def && def.enabled ? def : null;
      },
    );
    // Observability: one compact toast ONLY when something didn't fire (a throw,
    // an unresolved macro, or a guarded spec refused). All-green stays silent so
    // the happy path is noise-free.
    // Macro list unavailable (failed / refused for this role): unresolved macro
    // specs are expected, not errors — drop them from the report silently.
    const failedOutcomes = outcomes.filter((o) => !o.result.handled
      && !(o.spec.type === "macro" && o.result.reason === "macro-not-found" && !macrosLoadedRef.current));
    const failed = failedOutcomes.length;
    if (failed > 0) {
      const ran = outcomes.length - failed;
      const reasonText = (r?: string) =>
        r === "macro-not-found" ? "automation missing or disabled"
        : r === "refused-guard" ? "destructive step blocked on slides"
        : r === "threw" ? "error while running"
        : r === "unmappable" ? "not supported"
        : r || "not handled";
      const detail = failedOutcomes.slice(0, 2).map((o) => {
        const sp = o.spec;
        const name = sp.type === "macro" ? macrosRef.current.find((m) => m.id === sp.macroId)?.name : undefined;
        return `${describeSpec(sp, name)} (${reasonText(o.result.reason)})`;
      }).join("; ") + (failed > 2 ? `; +${failed - 2} more` : "");
      void import("sonner").then(({ toast }) =>
        toast.warning(`${ran} of ${outcomes.length} slide action${outcomes.length === 1 ? "" : "s"} ran — ${detail}`),
      );
    }
  }, [plan.items, dispatchEngineAction]);

  const sendPreview = useCallback(() => {
    sendSlideToLive(previewSlide, undefined, { instant: true, ...(stagedAISlide ? {} : { position: { itemIdx: preview.itemIdx, slideIdx: preview.slideIdx } }) });
    // A staged AI slide (e.g. a detected verse) is what projects here — the
    // playlist position underneath is NOT being sent, so its actions must not fire.
    if (!stagedAISlide) fireSlideActions(preview.itemIdx, preview.slideIdx);
  }, [previewSlide, stagedAISlide, sendSlideToLive, fireSlideActions, preview.itemIdx, preview.slideIdx]);

  // Mirror of `preview` so move() can compute the next cursor OUTSIDE the
  // setState updater (side effects — live send + slide actions — must not run
  // inside an updater, which StrictMode double-invokes). Advanced eagerly in
  // move() so rapid presses between renders don't reuse a stale cursor.
  const previewRef = useRef(preview);
  previewRef.current = preview;

  // Re-apply the CURRENT church layout to the slide already on screen: re-send its
  // pre-layout source through the pipeline (which re-runs applyChurchLayout with
  // the now-current default). instant:true = a clean hard cut (no fade); force
  // bypasses the already-live skip so a layout-only change actually re-projects.
  const reapplyLayoutToLive = useCallback(() => {
    // Never disturb an intentional blank/logo/empty screen.
    const cur = liveRef.current;
    if (!cur || cur.kind === "blank" || cur.kind === "logo" || cur.kind === "empty") return;
    const src = currentLiveSource(cur);
    // Reduce the source back to raw content so applyChurchLayout re-derives the
    // CURRENT layout (a pre-styled source would no-op — that's the whole trick).
    sendSlideToLive(sourceForRelayout(src), undefined, { instant: true, force: true, carryLiveOrigin: true });
  }, [sendSlideToLive, currentLiveSource]);

  // Any editor's "Apply to current slide" (or another surface) can push the
  // current layout onto the live slide via this event — "apply it back, anywhere".
  useEffect(() => {
    const onReapply = () => reapplyLayoutToLive();
    window.addEventListener("presentflow:reapply-layout-live", onReapply);
    return () => window.removeEventListener("presentflow:reapply-layout-live", onReapply);
  }, [reapplyLayoutToLive]);

  const move = useCallback((dir: 1 | -1) => {
    const cur = previewRef.current;
    // Y5: pure boundary-walk that SKIPS header items (slides:[]) in both
    // directions so navigation never lands on a divider (no-op when nowhere
    // valid to go). Returns `cur` unchanged at the ends.
    const next = nextPreviewPosition(plan.items, cur, dir);
    if (next === cur) return;
    previewRef.current = next;
    setPreview(next);
    if (autoSend) {
      const raw = plan.items[next.itemIdx]?.slides[next.slideIdx];
      if (raw) {
        const s = layoutForDirectSend(raw);
        setLive(s, next);
        chRef.current?.postMessage({ type: "set", slide: s } as LiveMessage);
        // Operator-initiated send → fire that slide's attached actions (AI paths never do).
        fireSlideActions(next.itemIdx, next.slideIdx);
      }
    }
  }, [plan.items, autoSend, fireSlideActions, layoutForDirectSend, setLive]);

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
      else if (e.key === "Enter") { e.preventDefault(); if (!e.repeat) sendPreview(); }
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
      if (s) {
        send(s, { itemIdx, slideIdx });
        // ProPresenter semantics (2026-09-14 user sign-off): a slide's actions run
        // whenever the OPERATOR puts it live — click, arrows, Enter, or a jump.
        fireSlideActions(itemIdx, slideIdx);
      }
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
  // clearLowerThird is defined AFTER sendLowerThird (below) so it can call the
  // real clear path — see the const near sendLowerThird. Placeholder removed.
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
  // REMOVED: legacy AI-autopilot effect that raced with the newer, correct
  // instant-live autopilot effect in ProOperatorShell.tsx ("Auto-approve →
  // INSTANT LIVE for scripture"). Two independent effects both watching
  // scripture detections could race/duplicate/disagree — that's why
  // auto-pushed verses sometimes landed on preview instead of live. There is
  // now a single AI-autopush code path (ProOperatorShell), and it always
  // goes live. `stagedAISlide`/`setStagedAISlide` remain in use elsewhere in
  // this file for legitimate manual "stage for preview" flows (bank nav,
  // song staging, etc.) — only this specific auto-triggering effect was removed.

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
        const rawSlide = bankedToSlide(next);
        const refLabel = `${next.book} ${next.chapter}:${next.verseStart}${next.verseStart !== next.verseEnd ? `-${next.verseEnd}` : ""}`;
        setAutopilotActivity({ source: "context-verse", ref: refLabel, ts: Date.now() });
        if (autoApprove.enabled && autoApprove.autoSendToLive) {
          const slide = layoutForDirectSend(rawSlide);
          setLive(slide);
          chRef.current?.postMessage({ type: "set", slide } as LiveMessage);
        } else {
          setStagedAISlide(rawSlide);
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
      if (cmd.verb === "captions_on" || cmd.verb === "captions_off") {
        // Captions aren't a shipped feature — say so plainly instead of offering a
        // fake "Approve" that only toasts a placeholder.
        toast.info("Live captions aren’t available yet.");
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
          setStagedAISlide({ kind: "text", text, reference: label });
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

  // REMOVED (2026-07-22): legacy song/lyric auto-accept-to-Preview effect.
  // This was a second, independent auto-behavior system for song detections
  // that raced with ProOperatorShell's SongAutopilotStaging (Part 6/6b) —
  // same class of bug the scripture auto-accept effect above was removed
  // for. It hardcoded "songs always stay Preview-only regardless of
  // confidence," which is now stale: policy (CLAUDE.md rule 7, 2026-07-22)
  // is a two-tier system — 60-84% stages for human "G" keypress confirm,
  // ≥85% goes live with zero clicks — implemented entirely in
  // SongAutopilotStaging's `autoLiveSong`. Having this effect ALSO staging
  // the same detections to Preview-only fought with that and was the direct
  // cause of high-confidence songs visibly staying in Preview instead of
  // going live. `stagedAISlide`/`setStagedAISlide` remain in use elsewhere
  // for legitimate manual "stage for preview" flows — only this specific
  // auto-triggering effect was removed.

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
  // (liveKey / liveItemIdx are computed earlier — moved above the theme
  // resolution so the section theme follows the LIVE item, not the preview.)

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
      fontScale: effectiveFontScale,
      referenceScale,
      referenceColor: referenceColor || undefined,
      background: backgroundSpec,
      appearance: effectiveAppearance,
      videoInput,
      zone: activeZone,
    };
    const nextLt = (line1 || line2) ? { line1, line2 } : null;
    // Hold it against the CURRENT live slide so later emits of that same slide
    // keep it; a different slide going live clears it.
    setHeldLowerThird(nextLt ? { lt: nextLt, sendSeq: liveSendSeqRef.current } : null);
    const rawLtState: OutputState = { ...base, lowerThird: nextLt };
    // Fail-open sanitize before the wire — the null-fallback `base` above is built
    // from a RAW `next`/`live` (unlike the main emit effect), so guard this path
    // too so a malformed neighbour field can never blank the projector.
    const state: OutputState = sanitizeOutputState(rawLtState) ?? rawLtState;
    safePost(chRef.current, { type: "output", state });
    // Through the remote publisher (scrub + Realtime + LAN) so a queued trailing
    // editor send can never land AFTER this and overwrite it.
    remotePublisherRef.current!.sendNow(state);
    lastOutputStateRef.current = state;
    publishObsPreviewState(state); // after the projector + remote posts
    toast.success(line1 || line2 ? "Lower third sent" : "Lower third cleared");
  }, [live, nextSlideForStage, plan.items, preview.itemIdx, preview.slideIdx, aspectRatio, fitMode, safeArea, countdownEndsAt, announcement, transitionSpec, nextItemForStage, fontScale, effectiveAppearance, videoInput, effectiveFontScale, referenceScale, referenceColor, backgroundSpec, activeZone]);
  // Actually CLEAR the lower third on the projector (was a placeholder toast
  // that left it on screen — a real live hazard). Reuses the working send path
  // with empty lines, which broadcasts lowerThird:null and toasts "cleared".
  const clearLowerThird = useCallback(() => sendLowerThird("", ""), [sendLowerThird]);

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
    // Routed through the remote publisher (sendNow drops any pending older
    // trailing editor value) so it can't be overwritten by a queued send.
    if (lastOutputStateRef.current) {
      const embedded: OutputState = { ...lastOutputStateRef.current, operatorMessage: text };
      remotePublisherRef.current!.sendNow(embedded);
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
    if (lastOutputStateRef.current) {
      const embedded: OutputState = { ...lastOutputStateRef.current, operatorMessage: null };
      remotePublisherRef.current!.sendNow(embedded);
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

  // Wave 7 — engine/macro entry point for the multi-timer session. The session
  // state lives in ProOperatorShell (useTimersSession); we emit a CustomEvent it
  // listens for, keeping ctx decoupled from that state (mirrors the existing
  // event-driven internal command pattern). No-op if no shell is mounted.
  const timerCommand = useCallback((timerId: string, command: "start" | "stop" | "reset") => {
    if (typeof window === "undefined") return;
    // Nonce-gated (Y1) so only in-app code can drive a timer — an XSS/extension
    // custom event is dropped by the isInternalEvent guard in ProOperatorShell.
    dispatchInternal("presentflow:timer-command", { timerId, command });
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
        toast.success("Slide order updated");
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

  // Wave 3 (item 4b): place a freshly-added service item at a specific index
  // (a section-header spring-drop wants the row right after the header).
  // addServiceItem always appends, so we follow up with a reorder. Fail-soft:
  // any error leaves the item appended (never lost); a null/out-of-range index
  // is a no-op (plain append behaviour preserved).
  const repositionNewItem = useCallback(async (newId: string, insertAtIndex?: number) => {
    if (typeof insertAtIndex !== "number" || !Number.isFinite(insertAtIndex)) return;
    // Pre-add snapshot ids, real UUIDs only (skip any lingering optimistic rows
    // and the just-added id itself), in current order.
    const existingIds = plan.items
      .map((it) => (it as { id?: string }).id)
      .filter((x): x is string => typeof x === "string" && !x.startsWith("optimistic-") && x !== newId);
    // Clamp + insert via the shared pure primitive (one source of truth with the
    // header-drop reorder) — fail-soft clamp keeps the item rather than losing it.
    const orderedIds = insertIdAtIndex(existingIds, newId, insertAtIndex);
    try {
      const r = await reorderServiceItems(plan.id, orderedIds);
      if (!r.ok) console.warn("[section-drop] reposition failed:", r.error);
    } catch (e) {
      console.warn("[section-drop] reposition threw:", e);
    }
  }, [plan.id, plan.items]);

  const shellCtx: OperatorShellCtx = useMemo(() => ({
    plan,
    previewSlide,
    liveSlide: live,
    // Effective (zone-folded) font scale so preview surfaces match the projector.
    fontScale: effectiveFontScale,
      referenceScale,
      referenceColor: referenceColor || undefined,
    background: backgroundSpec,
    videoInput,
    appearance: effectiveAppearance,
    zone: activeZone,
    // Decoupling Phase 3 — the operator Layers Panel reads these. `layersEngineOn`
    // is env-flag AND per-church opt-in; when false the panel renders a disabled
    // affordance (or nothing when the env kill-switch is off).
    layersEngineOn,
    liveLayers,
    onSetBackgroundMedia: setBackgroundMedia,
    dispatchEngineAction,
    fireSlideActions,
    previewItemIdx: preview.itemIdx,
    previewSlideIdx: preview.slideIdx,
    liveItemIdx,
    aspectRatio, fitMode, safeArea,
    onAspectChange: setAspectRatio,
    onFitChange: setFitMode,
    onSafeAreaToggle: () => setSafeArea((v) => !v),
    autopilotMode, onAutopilotModeChange: setAutopilotMode,
    serviceMode, onServiceModeChange: setServiceMode,
    autoApproveOn: autoApprove.enabled,
    autoSendToLive: autoApprove.autoSendToLive,
    audio,
    multiChannelCapture: multiChannelCapture ?? null,
    currentDeviceId: currentDeviceId ?? null,
    onListenToggle: () => {
      // Persist the operator's ON/OFF intent so the next app load resumes
      // listening automatically (2026-07-25 Bug-3 auto-start above).
      const turningOn = !audio.listening;
      try { window.localStorage.setItem(AI_LISTEN_INTENT_KEY, turningOn ? "1" : "0"); } catch { /* noop */ }
      // {operator:true} marks this as an explicit operator stop so it cancels
      // any pending mid-service device auto-reconnect (they chose to stop).
      if (turningOn) startAudio(); else stopAudio({ operator: true });
      // Confirmation so the operator knows the click registered (the pill also
      // flips colour). No autopilot-mode gate can undo this now — the AI
      // listener is purely intent-driven (stale manual-mode force-off removed).
      toast(turningOn ? "AI listening ON" : "AI listening OFF", { duration: 1400, icon: turningOn ? <Mic2 className="w-4 h-4" style={{ color: "#4fd18b" }} /> : <MicOff className="w-4 h-4" style={{ color: "#ff6d6d" }} /> });
    },
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
    onTimerCommand: timerCommand,
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
    churchId,
    // Bible-panel wiring
    onSendSlideToLive: sendSlideToLive,
    getLiveOrigin,
    // Live projection undo/redo (back/forward through what was shown).
    onUndoLive: undoLive,
    onRedoLive: redoLive,
    canUndoLive: liveHistoryVer >= 0 && liveUndoStackRef.current.length > 0,
    canRedoLive: liveHistoryVer >= 0 && liveRedoStackRef.current.length > 0,
    onStageSlide: stageSlide,
    onBankAddReference: bankAdd,
    onSendBankedToLive: sendBankedToLive,
    onRemoveBanked: removeBanked,
    onDeleteSlide, // R2
    onReorderSlidesInItem, // Task C
    // Library → Playlist add (drag or click).
    onAddLibraryItem: async (kind, ref, insertAtIndex) => {
      const payload =
        kind === "song" ? { songId: ref.id } :
        kind === "media" ? { mediaAssetId: ref.id } :
        { pptxImportId: ref.id };
      const { addServiceItem } = await import("@/lib/actions");
      const res = await addServiceItem(plan.id, kind, ref.title, payload);
      if (res.ok) {
        // Offer an Undo when a new row was actually created (res.data present;
        // absent when the server dedup no-ops on an item already in the plan).
        if (res.data) {
          const newItemId = res.data.id;
          toast(`Added: ${ref.title}`, {
            action: {
              label: "Undo",
              onClick: () => {
                void (async () => {
                  const { removeServiceItem } = await import("@/lib/actions");
                  const r = await removeServiceItem(newItemId);
                  if (!r.ok) { toast.error(r.error ?? "Undo failed"); return; }
                  router.refresh();
                })();
              },
            },
          });
        } else {
          toast.success(`Added: ${ref.title}`);
        }
        // R2 (P6): optimistic append + router.refresh instead of full page
        // reload. Full reload broke interim transcript state, forced a mic
        // re-prompt, and dropped BroadcastChannel state (CLAUDE.md rule 8).
        // router.refresh() re-fetches server component data without
        // remounting the whole app.
        const optimisticId = `optimistic-${Date.now()}`;
        // 2026-07-24 field bug fix: optimistic `slides: []` produced a
        // permanent "0" in the playlist row's slide-count badge for songs
        // added via chip-click, until router.refresh() completed (which
        // could hang or race). If we're adding a song we already have
        // in the indexed library, seed the optimistic slides with the
        // song's known lyric slides so the playlist row shows the right
        // count immediately AND the operator can preview/send before the
        // server round-trip finishes.
        const libSong = kind === "song" ? songLibrary.find((s) => s.songId === ref.id) : null;
        const optimisticSlides = libSong && Array.isArray(libSong.slides)
          ? libSong.slides.map((s) => ({ kind: "text" as const, text: s.lyrics || "" }))
          : [];
        setPlan((prev) => {
          // 2026-07-25 field bug fix: client-side dedup mirrors the
          // server-side dedup in addServiceItem (actions.ts:124-134).
          // Without this, the optimistic add stacked on top of an
          // existing playlist row for the same songId, producing the
          // "2× Amazing Grace" the user reported. If the server
          // dedupes silently (returns ok:true, no new row), the
          // optimistic push added a phantom duplicate that persisted
          // until router.refresh() completed.
          const alreadyIn = prev.items.some((it) => {
            if (kind === "song" && (it as { songId?: string }).songId === ref.id) return true;
            if (kind === "media" && (it as { mediaAssetId?: string }).mediaAssetId === ref.id) return true;
            if (kind === "sermon" && (it as { pptxImportId?: string }).pptxImportId === ref.id) return true;
            return false;
          });
          if (alreadyIn) return prev;
          const newItem = {
            id: optimisticId,
            title: ref.title,
            type: kind,
            songId: kind === "song" ? ref.id : undefined,
            mediaAssetId: kind === "media" ? ref.id : undefined,
            pptxImportId: kind === "sermon" ? ref.id : undefined,
            slides: optimisticSlides,
          } as unknown as ExpandedItem;
          return { ...prev, items: [...prev.items, newItem] };
        });
        // Focus preview on the newly added item.
        setPreview({ itemIdx: plan.items.length, slideIdx: 0 });
        // Wave 3 (item 4b): a section-header spring-drop asks for the new row to
        // sit at a specific index (right after the header). addServiceItem always
        // appends, so reposition here via a follow-up reorder. Fail-soft: if the
        // reorder errors the item simply stays appended (never lost).
        if (res.data?.id) await repositionNewItem(res.data.id, insertAtIndex);
        router.refresh();
      } else {
        toast.error(res.error || "Add failed");
      }
    },
    onAddMediaGroup: async (title, assetIds, insertAtIndex) => {
      const ids = assetIds.filter((x) => typeof x === "string" && x.length > 0);
      if (ids.length === 0) return;
      const safeTitle = (title || "Images").trim().slice(0, 120) || "Images";
      const { addServiceItem } = await import("@/lib/actions");
      const res = await addServiceItem(plan.id, "media", safeTitle, { mediaAssetIds: ids });
      if (!res.ok) { toast.error(res.error || "Add failed"); return; }
      if (res.data) {
        const newItemId = res.data.id;
        toast(`Added group: ${safeTitle}`, {
          action: {
            label: "Undo",
            onClick: () => { void (async () => {
              const { removeServiceItem } = await import("@/lib/actions");
              const r = await removeServiceItem(newItemId);
              if (!r.ok) { toast.error(r.error ?? "Undo failed"); return; }
              router.refresh();
            })(); },
          },
        });
      }
      // Optimistic append: one item whose slide count = the group size, so the
      // playlist row shows the right badge before the server round-trip lands.
      const optimisticId = `optimistic-${Date.now()}`;
      setPlan((prev) => {
        const newItem = {
          id: optimisticId,
          title: safeTitle,
          type: "media",
          mediaAssetIds: ids,
          slides: ids.map(() => ({ kind: "image" as const, url: "" })),
        } as unknown as ExpandedItem;
        return { ...prev, items: [...prev.items, newItem] };
      });
      setPreview({ itemIdx: plan.items.length, slideIdx: 0 });
      if (res.data?.id) await repositionNewItem(res.data.id, insertAtIndex);
      router.refresh();
    },
  }), [
    // Y6: only re-pack when the values consumers actually read change.
    plan, previewSlide, live, preview.itemIdx, preview.slideIdx, liveItemIdx,
    aspectRatio, fitMode, safeArea, autopilotMode, autoApprove.enabled, activeZone,
    layersEngineOn, liveLayers, setBackgroundMedia, dispatchEngineAction, fireSlideActions,
    autoApprove.autoSendToLive, audio, confidenceThreshold, defaultTranslationCode,
    countdownEndsAt, announcement, transitionSpec,
    effectiveBank, currentBankIdx, internetMatches, historyKey,
    // callbacks
    repositionNewItem,
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
    startAudio, stopAudio, effectiveAppearance,
    // Preview WYSIWYG — recompute the ctx when these output values change so the
    // operator preview reflects size/colour/background even when AI is off.
    effectiveFontScale, referenceScale, referenceColor, backgroundSpec, videoInput,
    // Live undo/redo: liveHistoryVer forces the can-* flags to recompute.
    undoLive, redoLive, liveHistoryVer,
  ]);

  // Keep the dispatcher's live-ctx ref current every render so
  // dispatchEngineAction always targets the freshest handlers.
  ctxRef.current = shellCtx;

  return (
    <>
      <ServiceModeBanner />
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
      {/* R3: Desktop shell = ProOperatorShell; web keeps the legacy OperatorShell.
          Wrap the entire shell in an outer error boundary as the last safety
          net — inner panels have their own boundaries in ProOperatorShell,
          but a crash in the shell itself (e.g., a hotkey installer, a top-bar
          layout error) would otherwise white-screen the whole app. */}
      <OperatorErrorBoundary fallbackLabel="Operator shell crashed">
        {shell === "desktop" ? <ProOperatorShell ctx={shellCtx} /> : <OperatorShell ctx={shellCtx} />}
      </OperatorErrorBoundary>
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
      {/* Projection Zone Customizer — the floating operator-screen button was
          removed per user request. The zone still drives projector output via
          OutputState.zone; the editor is opened from the "presentflow:open-zone-editor"
          event so the feature stays reachable without a floating control. */}
      <ZoneEditor open={zoneEditorOpen} onClose={() => setZoneEditorOpen(false)} />
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
