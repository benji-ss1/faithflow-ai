"use client";
/**
 * RightIconBar — Phase 3 of the right-panel refactor (2026-07-25).
 *
 * Replaces the two-section AIDetectionsPanel (Bible / Songs stacked
 * vertically, taking up the whole lower half of the sidebar) AND the
 * six-tab RightTabs (Audio/Stage/Timers/Messages/Themes/Macros) with
 * a single horizontal icon toolbar. Each icon opens a Radix Popover
 * that floats above the bar with scrollable content.
 *
 * Icons use lucide-react (NOT emojis, per the field spec). Badge
 * counts on Bible/Songs/Cross-Refs show live detection activity.
 *
 * Only one popover is open at a time (controlled state); clicking
 * outside or pressing Escape closes it. Clicking a different icon
 * atomically swaps content.
 *
 * Popover content strategy for this ship:
 * - Bible / Songs / Cross-Refs → embed the existing AIDetectionsPanel
 *   with a `sections` prop so each popover shows only its slice. This
 *   preserves the proven detection dedupe/dismiss/click-to-load logic
 *   without rewriting 400 LOC.
 * - Logs → dismissed-detections list (new — read from AIDetectionsPanel's
 *   dismissed set via a shared context in a follow-up; MVP shows a
 *   placeholder pointing at browser DevTools console).
 * - Settings → RETIRED (2026-09-17). The bottom-right gear is gone; its two
 *   sub-tabs (Automations, Bible/CCLI) now live in the main Settings window
 *   opened from the top-bar gear (Settings › Automations, Settings › Bible &
 *   Detection). Nothing was lost — the same components render there.
 * - Screens → embeds ScreensPanel (per-machine resolution + display
 *   assignment + Configure Screens button).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { loadSessionState, updateSessionState } from "@/lib/operatorSessionState";
import * as Popover from "@radix-ui/react-popover";
import { BookOpen, Music, Link2, Layers as LayersIcon, Timer as TimerIcon, MessageSquare, MonitorPlay as MonitorIcon } from "lucide-react";
import { LAYERS_V2 } from "@/lib/output-layers";
import { LayersPanel } from "./LayersPanel";
import { Pp7LayersPanel } from "./Pp7LayersPanel";
import { usePp7Layers } from "@/lib/pp7-layers-flag";
import { usePp7Messages } from "./usePp7Layers";
import { cn } from "@/lib/utils";
import type { OperatorShellCtx } from "../../shell/types";
import type { TimerApi, MessagesApi, TimersApi, MessagesBoardApi } from "../hooks";
import { AIDetectionsPanel } from "./AIDetectionsPanel";
import { useRightRailDetections } from "./useRightRailDetections";
import { countCrossRefCandidates } from "@/lib/right-rail-visible";
import { TimersPanel } from "./TimersPanel";
import { StageLayoutPanel } from "./StageLayoutPanel";
import type { StageLayoutsApi } from "./useStageLayouts";
import { MessagesPanel } from "./MessagesPanel";
import { ThemesModal } from "../ThemesModal";
import { readLegacyThemesFlag, OPEN_THEME_POPOVER_EVENT } from "@/lib/legacy-themes-flag";
import { ChannelStrip } from "../../ChannelStrip";
import { OPEN_SETTINGS_EVENT } from "../../settings/SettingsWindow";
// Change 5C (2026-07-27) — right-icon Screens tab retired. Duplicated the
// left-sidebar Hardware > Screens slide-out shipped in v0.1.91 (JPD Fix 7).
// HardwarePanel still imports ScreensPanel directly; the component is
// unchanged. Only the right-side entry point is removed.

type PopoverKey = "bible" | "songs" | "xrefs" | "logs" | "themes" | "layers" | "timers" | "messages" | "stage";

// First-run discoverability for the Layers panel: set once the operator opens
// Layers for the first time. Until then (and only when Layers is enabled for the
// church) a subtle pulse dot + "New: Layers" tooltip draws attention to the icon.
const LAYERS_OPENED_KEY = "presentflow.layers.opened.v1";

export function RightIconBar({
  ctx, timer, messages, timers, messagesBoard, stageLayouts,
}: {
  ctx: OperatorShellCtx;
  timer: TimerApi;
  messages: MessagesApi;
  timers: TimersApi;
  messagesBoard: MessagesBoardApi;
  /** Owned by the shell so there is ONE instance — the shell also publishes
   *  the assigned layout onto OutputState for /stage to render. */
  stageLayouts: StageLayoutsApi;
}) {
  // PP7 Layers panel (2026-09-17). Flag OFF ⇒ the legacy LayersPanel renders
  // exactly as before — `NEXT_PUBLIC_PP7_LAYERS=0` / localStorage
  // `presentflow.pp7Layers.v1="0"` is a true reversal.
  const pp7Layers = usePp7Layers();
  const pp7Messages = usePp7Messages({ messages, messagesBoard, timer, timers });
  const [openKey, setOpenKeyInner] = useState<PopoverKey | null>(null);
  // JPD Fix 5 (2026-07-27): restore the last-open sidebar popover on
  // relaunch and persist changes. Restore runs post-mount (no SSR/hydration
  // mismatch) and only accepts currently-valid keys — "logs" is UI-hidden,
  // so a stale "logs" value stays closed (see the popover comment below).
  const setOpenKey = useCallback((k: PopoverKey | null) => {
    setOpenKeyInner(k);
    updateSessionState({ sidebarTab: k });
  }, []);
  // First-run Layers pulse. Default true (no SSR flash / no dot), then flip to
  // false post-mount iff Layers is enabled for the church AND never opened.
  const [layersSeen, setLayersSeen] = useState(true);
  useEffect(() => {
    if (!LAYERS_V2 || !ctx.layersEngineOn) return;
    try {
      if (window.localStorage.getItem(LAYERS_OPENED_KEY) !== "1") setLayersSeen(false);
    } catch { /* noop */ }
  }, [ctx.layersEngineOn]);
  // Mark Layers as opened the first time its popover opens → clears the pulse.
  useEffect(() => {
    if (openKey !== "layers" || layersSeen) return;
    setLayersSeen(true);
    try { window.localStorage.setItem(LAYERS_OPENED_KEY, "1"); } catch { /* noop */ }
  }, [openKey, layersSeen]);

  // Deep-link + programmatic panel opening. The What's New "Open Layers →"
  // button dispatches presentflow:open-panel; a ?panel=layers query (e.g.
  // navigating in from the dashboard) opens it on mount. Only valid keys open.
  useEffect(() => {
    const openPanel = (name: string | null) => {
      if (name === "layers") { if (LAYERS_V2 && ctx.layersEngineOn) setOpenKey("layers"); return; }
      // 2026-09-17: the old sidebar Settings popover is retired. A legacy
      // ?panel=settings deep-link now opens the real Settings window.
      if (name === "settings") { window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT)); return; }
      if (name === "bible" || name === "songs" || name === "xrefs") setOpenKey(name);
    };
    const onOpenPanel = (e: Event) => openPanel((e as CustomEvent<{ panel?: string }>).detail?.panel ?? null);
    window.addEventListener("presentflow:open-panel", onOpenPanel);
    try {
      const p = new URLSearchParams(window.location.search).get("panel");
      if (p) openPanel(p);
    } catch { /* noop */ }
    return () => window.removeEventListener("presentflow:open-panel", onOpenPanel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.layersEngineOn]);

  useEffect(() => {
    const saved = loadSessionState()?.sidebarTab;
    // Change 5C — "screens" removed from the valid-key list. A stale
    // "screens" from a prior version silently no-ops here (bar stays clean).
    // "settings" removed 2026-09-17 alongside "screens": a stale saved value
    // silently no-ops (the bar stays clean).
    if (saved === "bible" || saved === "songs" || saved === "xrefs") {
      setOpenKeyInner(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Audio Guardian (2026-07-27) — the shell's red "⚠ AUDIO" chip needs a
  // programmatic way into the Audio hardware panel. We own the listener.
  // Themes now opens as a full-screen operator modal (not a sidebar popover).
  const [themesModalOpen, setThemesModalOpen] = useState(false);
  useEffect(() => {
    // Audio tab removed from Settings — the AUDIO guardian chip already surfaces
    // the issue inline; operators can check hardware settings in the left sidebar.
    const onOpenAudioSettings = () => {
      // 2026-09-16: was a no-op (the ⚠ AUDIO chip did nothing). Open the real
      // Audio hardware panel in the left sidebar instead.
      window.dispatchEvent(new CustomEvent("presentflow:open-hardware", { detail: { panel: "audio" } }));
    };
    // 2026-09-18: the legacy Themes screen (ThemesManager in ThemesModal) is
    // RETIRED. This event — still fired by Settings → "Open themes" and by any
    // legacy deep-link — now forwards to the PP7 Themes popover so nothing
    // dead-ends. With the NEXT_PUBLIC_LEGACY_THEMES escape hatch on, it opens
    // the old modal exactly as before. See docs/THEMES_MANAGER_RETIREMENT.md.
    const onOpenThemesSettings = () => {
      if (readLegacyThemesFlag()) { setThemesModalOpen(true); return; }
      window.dispatchEvent(new CustomEvent(OPEN_THEME_POPOVER_EVENT));
    };
    window.addEventListener("presentflow:open-audio-settings", onOpenAudioSettings);
    window.addEventListener("presentflow:open-themes-settings", onOpenThemesSettings);
    return () => {
      window.removeEventListener("presentflow:open-audio-settings", onOpenAudioSettings);
      window.removeEventListener("presentflow:open-themes-settings", onOpenThemesSettings);
    };
  }, [setOpenKey]);

  // Badge counts = EXACTLY the rows the Bible / Songs / Cross-refs popovers
  // render (same threshold, 10-min expiry, dedupe, dismissed + failed-lookup
  // sets, 5-min/max-3 phrase groups). The rows + sets live here (always
  // mounted) so dismissals survive popover close and counts expire on a 15s
  // tick even while the popover is closed. See src/lib/right-rail-visible.ts.
  const detections = useRightRailDetections(ctx.audio, ctx.confidenceThreshold ?? 50, {
    planId: ctx.planId, translationCode: ctx.defaultTranslationCode,
  });
  const bibleCount = detections.bibleRows.length;
  const songCount = detections.songRows.length;
  // Cross-refs panel renders one row per candidate verse, so count candidates.
  const xrefCount = countCrossRefCandidates(detections.phraseGroups);

  return (
    <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-panel)]">
      {/* Multi-channel strip: shows per-channel meters when a mixer is active */}
      <ChannelStrip capture={ctx.multiChannelCapture} deviceId={ctx.currentDeviceId} />
      <div className="flex items-stretch h-11 px-1">
        <IconTrigger
          k="bible" openKey={openKey} setOpen={setOpenKey}
          Icon={BookOpen} label="Bible detections" badge={bibleCount}
        />
        <IconTrigger
          k="songs" openKey={openKey} setOpen={setOpenKey}
          Icon={Music} label="Song detections" badge={songCount}
        />
        <IconTrigger
          k="xrefs" openKey={openKey} setOpen={setOpenKey}
          Icon={Link2} label="Cross-references" badge={xrefCount}
        />
        {/* 2026-07-25 — Logs icon hidden per operator directive.
            Underlying logging pipeline remains; only the UI entry point
            is removed. Uncomment when we have a real dismissed-detections
            history view (currently just a "check DevTools" placeholder). */}
        {/* <IconTrigger
          k="logs" openKey={openKey} setOpen={setOpenKey}
          Icon={ScrollText} label="Logs"
        /> */}
        {/* Decoupling Phase 3: Layers entry. Rendered ONLY when the global
            NEXT_PUBLIC_LAYERS_V2 kill-switch is on (zero DOM otherwise). The
            per-church opt-in is handled inside LayersPanel (disabled note). */}
        {LAYERS_V2 && (
          <IconTrigger
            k="layers" openKey={openKey} setOpen={setOpenKey}
            Icon={LayersIcon}
            label={!ctx.layersEngineOn ? "Layers (not enabled for this church)" : layersSeen ? "Layers" : "New: Layers"}
            attention={ctx.layersEngineOn && !layersSeen}
          />
        )}
        <IconTrigger
          k="timers" openKey={openKey} setOpen={setOpenKey}
          Icon={TimerIcon} label="Timers" badge={timers.slots.filter((s) => s.shown).length}
        />
        {/* Stage layouts — ProPresenter's Screens > Edit Layouts. The whole
            subsystem existed with no way in until 2026-09-21. */}
        <IconTrigger
          k="stage" openKey={openKey} setOpen={setOpenKey}
          Icon={MonitorIcon} label="Stage layouts"
        />
        <IconTrigger
          k="messages" openKey={openKey} setOpen={setOpenKey}
          Icon={MessageSquare} label="Messages"
          badge={messagesBoard.active.length + (messages.state.showing ? 1 : 0)}
        />
        {/* 2026-09-17 — Settings gear removed from this row. Its contents
            (Automations, Bible/CCLI) moved to the main Settings window opened
            from the top-bar gear beside the logo. */}
        {/* Change 5C (2026-07-27) — Screens icon removed. Left sidebar
            Hardware > Screens (HardwarePanel) is the sole entry point. */}
      </div>

      {/* Popovers ------------------------------------------------------- */}
      {openKey === "bible" && (
        <PopoverShell title="Bible detections" onClose={() => setOpenKey(null)}>
          <AIDetectionsPanel ctx={ctx} sections={["bible"]} detections={detections} />
        </PopoverShell>
      )}
      {openKey === "songs" && (
        <PopoverShell title="Song detections" onClose={() => setOpenKey(null)}>
          <AIDetectionsPanel ctx={ctx} sections={["songs"]} detections={detections} />
        </PopoverShell>
      )}
      {openKey === "xrefs" && (
        <PopoverShell title="Cross-references" onClose={() => setOpenKey(null)}>
          <AIDetectionsPanel ctx={ctx} sections={["xrefs"]} detections={detections} />
        </PopoverShell>
      )}
      {/* Logs popover render also disabled — see IconTrigger comment above.
          If openKey somehow ends up "logs" (stale localStorage), no popover
          renders and the icon-bar row is clean. */}
      {LAYERS_V2 && openKey === "layers" && (
        <PopoverShell title="Layers" onClose={() => setOpenKey(null)}>
          {pp7Layers
            ? <Pp7LayersPanel ctx={ctx} messagesActive={pp7Messages.active} onClearMessages={pp7Messages.clear} />
            : <LayersPanel ctx={ctx} />}
        </PopoverShell>
      )}
      {openKey === "timers" && (
        <PopoverShell title="Timers" onClose={() => setOpenKey(null)}>
          <TimersPanel quick={timer} timers={timers} />
        </PopoverShell>
      )}
      {openKey === "stage" && (
        <PopoverShell title="Stage layouts" onClose={() => setOpenKey(null)}>
          <StageLayoutPanel api={stageLayouts} timers={timers} />
        </PopoverShell>
      )}
      {openKey === "messages" && (
        <PopoverShell title="Messages" onClose={() => setOpenKey(null)}>
          <MessagesPanel compose={messages} board={messagesBoard} />
        </PopoverShell>
      )}
      {/* Change 5C — Screens popover render block removed. */}

      {/* Themes — RETIRED legacy modal. Only ever mounted when the
          NEXT_PUBLIC_LEGACY_THEMES escape hatch brings it back; the live
          surface is the ThemePopover on the top bar. */}
      {themesModalOpen ? <ThemesModal open onClose={() => setThemesModalOpen(false)} /> : null}
    </div>
  );
}

function IconTrigger({
  k, openKey, setOpen, Icon, label, badge, attention,
}: {
  k: PopoverKey;
  openKey: PopoverKey | null;
  setOpen: (k: PopoverKey | null) => void;
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  badge?: number;
  // First-run attention affordance (subtle brand pulse dot). Cleared by the
  // parent once the panel is opened for the first time.
  attention?: boolean;
}) {
  const active = openKey === k;
  return (
    <Popover.Root open={active} onOpenChange={(o) => setOpen(o ? k : null)}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className={cn(
            "group relative flex-1 h-full flex items-center justify-center transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-inset",
            active
              ? "text-[var(--color-brand)] border-b-2 border-[var(--color-brand)]"
              : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-white/5",
          )}
        >
          {/* dock-style magnify bounce on hover */}
          <Icon className="w-4 h-4 transition-transform duration-150 ease-out group-hover:scale-[1.35] group-hover:-translate-y-0.5 group-active:scale-110" />
          {attention && !(typeof badge === "number" && badge > 0) && (
            <span
              aria-hidden
              className="absolute top-1.5 right-1/2 translate-x-3 w-2 h-2 rounded-full animate-pulse"
              style={{ background: "var(--color-brand)", boxShadow: "0 0 0 3px color-mix(in oklab, var(--color-brand) 30%, transparent)" }}
            />
          )}
          {typeof badge === "number" && badge > 0 && (
            <span
              aria-label={`${badge} new`}
              className="absolute top-1.5 right-1/2 translate-x-4 min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center text-[9px] font-mono font-semibold text-white"
              style={{ background: "var(--color-brand)" }}
            >
              {badge > 99 ? "99+" : badge}
            </span>
          )}
        </button>
      </Popover.Trigger>
      {/* Popover.Portal is intentionally NOT used — we render the popover
          body inline (see PopoverShell below rendered in parent). Radix
          Popover.Content in a Portal would need coordinate math to align
          under this icon bar; an inline expand-down works cleaner for a
          single-open-at-a-time bar. */}
    </Popover.Root>
  );
}

function PopoverShell({
  title, onClose, children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  // The shell is rendered INLINE at the bottom of the right aside (see the
  // comment on IconTrigger: no Portal). The icon bar already sits at the
  // bottom of that scrolling aside, so an opened panel lands ~315px BELOW the
  // fold at every viewport (measured 2026-09-18: 911x512, 1093x614, 1280x720)
  // and the operator sees nothing happen. Pull it into view on open.
  const shellRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    shellRef.current?.scrollIntoView({ block: "nearest" });
  }, []);
  return (
    <div
      ref={shellRef}
      className="border-t border-[var(--color-border)] bg-[var(--color-elevated)]"
      role="dialog"
      aria-label={title}
    >
      <div className="flex items-center justify-between px-2 h-7 border-b border-[var(--color-border)]">
        <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-muted-foreground)]">
          {title}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-[13px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] px-1"
          aria-label="Close"
        >
          ×
        </button>
      </div>
      {/* 400px does not fit a 512-614px CSS viewport (1366x768 @150%/@125%),
          which is the common Windows church laptop. Same idiom as the editor
          toolbars' [@media(max-height:620px)] step-down; a no-op at the Mac
          window height (900), so the Mac class list is unchanged there. */}
      <div className="max-h-[400px] [@media(max-height:700px)]:max-h-[220px] overflow-y-auto pf-transcript-scroll">
        {children}
      </div>
    </div>
  );
}
