"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import * as Tooltip from "@radix-ui/react-tooltip";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import { useTier } from "@/hooks/useTier";
import { canAccess } from "@/lib/tier";
import { MaxUpgradePrompt } from "@/components/tier/MaxUpgradePrompt";
import {
  Search, Play, BookOpen,
  Sparkles, Image as ImageIcon, MonitorSpeaker, Circle, ScreenShare,
  Music, ChevronDown, Palette,
} from "lucide-react";
import Image from "next/image";
import type { OperatorShellCtx } from "../shell/types";
import type { CenterMode } from "./ProOperatorShell";
import { cn } from "@/lib/utils";
import { SearchPalette } from "./SearchPalette";
import { AIDiagnosticModal, type LiveAudioStats } from "../AIDiagnosticModal";
import { readNativeDevicePref } from "@/lib/audio/nativeDeviceStore";
import type { DisplayInfo } from "@/types/electron";
import { dispatchInternal } from "@/lib/internal-events";
import { FONT_SCALE_KEY, readFontScale, FONT_SCALE_MIN, FONT_SCALE_MAX, FONT_SCALE_STEP } from "./operatorConstants";

function IconBtn({
  icon: Icon, label, active, onClick,
}: { icon: typeof Search; label: string; active?: boolean; onClick?: () => void }) {
  return (
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            onClick={onClick}
            title={label}
            className={cn(
              "w-[34px] h-[34px] flex items-center justify-center rounded-md transition-colors",
              "hover:bg-white/5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
              active && "text-[var(--color-foreground)] border-b-2 border-[var(--color-brand)] rounded-b-none",
            )}
            aria-label={label}
            style={{ fontFamily: "var(--font-display)" }}
          >
            <Icon className="w-4 h-4" />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            sideOffset={4}
            className="rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] px-2 py-1 text-[11px] z-50"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {label}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

function ModeBtn({
  icon: Icon, label, active, onClick, emphasized,
}: {
  icon: typeof BookOpen;
  label: string;
  active: boolean;
  onClick: () => void;
  emphasized?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center justify-center gap-1.5 h-[34px] rounded-md transition-colors",
        "border text-[12px] font-medium",
        emphasized ? "min-w-[88px] px-3" : "min-w-[72px] px-2.5",
        active
          ? "bg-[var(--color-elevated)] text-[var(--color-foreground)] border-[var(--color-brand)]"
          : "bg-transparent text-[var(--color-muted-foreground)] border-[var(--color-border)] hover:text-[var(--color-foreground)] hover:bg-white/5",
        emphasized && active && "border-b-[3px]",
        emphasized && !active && "border-[var(--color-border)] hover:border-[var(--color-brand)]",
      )}
    >
      <Icon className={cn(emphasized ? "w-4 h-4" : "w-3.5 h-3.5")} />
      <span className={cn(emphasized && "font-semibold")}>{label}</span>
    </button>
  );
}

const PREVIEW_DISPLAY_KEY = "presentflow.pro.previewDisplay";
const DEFAULT_OUTPUT_KEY = "presentflow.pro.defaultOutput.v1";

type DefaultOutputOption =
  | { kind: "default" }
  | { kind: "in-house" }
  | { kind: "livestream" }
  | { kind: "custom"; name: string };

function labelForOutput(o: DefaultOutputOption): string {
  switch (o.kind) {
    case "default": return "Default";
    case "in-house": return "In-house Stream";
    case "livestream": return "Livestream";
    case "custom": return o.name || "Custom";
  }
}

export function TopBar({
  centerMode, onCenterMode, onToggleMediaStrip, mediaStripOpen, ctx,
}: {
  centerMode: CenterMode;
  onCenterMode: (m: CenterMode) => void;
  onToggleMediaStrip: () => void;
  mediaStripOpen: boolean;
  ctx: OperatorShellCtx;
}) {
  const isLive = ctx.liveSlide.kind !== "empty";
  const currentTitle =
    centerMode === "bible" ? "Bible"
    : centerMode === "songs" ? "Songs Library"
    : centerMode === "media" ? "Media Library"
    : (ctx.plan.items[ctx.previewItemIdx]?.title ?? "");
  // Binary AI state — revamped from the old 4-state
  // OFF/CONNECTING/READY/LIVE pill that flickered as the connection churned.
  // The pill now reflects only the operator's ON/OFF INTENT (`listening`),
  // which stays true across silent background reconnects and only flips false
  // on a manual stop or a genuine unrecoverable give-up. No "connecting"
  // limbo, no amber, no sleep state.
  const listening = ctx.audio.listening;
  // Hard-failure affordance only: shown when the listener has exhausted all
  // reconnects and truly given up (distinct from any transient blip, which
  // never surfaces). At that point `listening` is already false → pill OFF.
  const aiHardFailed = ctx.audio.reconnectFailed;
  // Roadmap #7 spinner REMOVED 2026-07-24: user reported it read as "the
  // AI is stopping" rather than "the socket is reconnecting in the
  // background", violating the spirit of the binary AI ON / AI OFF rule
  // documented above and locked in July 2026. Reconnects still happen
  // silently — the pill stays green throughout — but no visual affordance
  // is shown for them. If reconnects are actually failing badly, that's
  // an infrastructure problem to fix at the source (see 2026-07-23
  // DG-stall + KeepAlive work), not a UI symptom to surface.
  const aiTitle = listening ? "AI ON — click to turn off" : "AI OFF — click to turn on";

  const [searchOpen, setSearchOpen] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);
  // Heartbeat clock — re-render every 2s while listening so the dot can decay
  // green → amber when transcripts stop arriving (lastTranscriptAt goes stale
  // without any state change to trigger a render). Cheap: one shallow render
  // of TopBar per tick, nothing below it depends on this value.
  const [heartbeatNow, setHeartbeatNow] = useState(() => Date.now());
  useEffect(() => {
    if (!listening) return;
    const id = setInterval(() => setHeartbeatNow(Date.now()), 2000);
    return () => clearInterval(id);
  }, [listening]);
  const { tier } = useTier();
  const canProContent = tier !== null && canAccess(tier, "pro-content");
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [previewDisplay, setPreviewDisplay] = useState<number | null>(null);
  // Task F: Max-gated default output selection. Persists to localStorage.
  const [defaultOutput, setDefaultOutput] = useState<DefaultOutputOption>({ kind: "default" });
  const [customDialogOpen, setCustomDialogOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const [maxPromptOpen, setMaxPromptOpen] = useState(false);

  // #4 — Big Auto-approve toggle. Simplifies the 4-mode autopilot to on/off:
  //   OFF => "suggestion" (chips shown, operator must click)
  //   ON  => "active"    (high-confidence detections auto-send)
  // The "armed" intermediate mode is skipped for demo simplicity, but the
  // confirm() ceremony is preserved when toggling ON.
  const autoApproveOn = ctx.autopilotMode === "active";
  const AUTO_APPROVE_KEY = "presentflow.pro.autoApprove.v1";
  // 2026-08-16 (user sign-off): persist the operator's AUTO choice ACROSS app
  // restarts. The original sessionStorage-only design forced a re-arm every
  // launch as an XSS hardening measure; on the church's own desktop machine the
  // operator explicitly wants AUTO to stay ON so the service starts hot, not
  // cold. This localStorage key restores the last explicit toggle on launch.
  const AUTO_APPROVE_PERSIST_KEY = "presentflow.pro.autoApprove.persist.v1";

  // B3 — manual projector text-size. Persisted to localStorage; the change
  // event is picked up by OperatorConsole, which syncs it to all output
  // surfaces via OutputState.
  const [fontScale, setFontScaleState] = useState(1);
  useEffect(() => { setFontScaleState(readFontScale()); }, []);
  const changeFontScale = (next: number) => {
    const clamped = Math.max(FONT_SCALE_MIN, Math.min(FONT_SCALE_MAX, Math.round(next * 100) / 100));
    setFontScaleState(clamped);
    try { localStorage.setItem(FONT_SCALE_KEY, String(clamped)); } catch { /* noop */ }
    try { window.dispatchEvent(new CustomEvent("presentflow:font-scale-changed", { detail: { scale: clamped } })); } catch { /* noop */ }
  };
  const fontIsAuto = Math.abs(fontScale - 1) < 1e-6;
  useEffect(() => {
    // Y3: sessionStorage instead of localStorage. Cleared on tab close;
    // operator must re-arm each session — XSS-flipping the flag no longer
    // arms auto-live silently across restarts. We ALSO wipe the legacy
    // localStorage key so a compromised value there can't override.
    try {
      window.sessionStorage.setItem(AUTO_APPROVE_KEY, autoApproveOn ? "1" : "0");
      // Retire the legacy localStorage entry (its old semantics).
      window.localStorage.removeItem(AUTO_APPROVE_KEY);
      // Persist the operator's explicit choice so it survives an app restart.
      window.localStorage.setItem(AUTO_APPROVE_PERSIST_KEY, autoApproveOn ? "1" : "0");
    } catch { /* ignore */ }
    // R4: notify the shell so any live auto-advance interval is cleared.
    try {
      window.dispatchEvent(new CustomEvent("presentflow:auto-approve-changed", { detail: { on: autoApproveOn } }));
    } catch { /* ignore */ }
  }, [autoApproveOn]);
  const toggleAutoApprove = () => {
    if (autoApproveOn) {
      ctx.onAutopilotModeChange("suggestion");
    } else {
      // Confirm ceremony preserved.
      const ok = typeof window !== "undefined"
        ? window.confirm("Turn ON Auto-approve?\n\nHigh-confidence detections will send to LIVE without operator input. Songs on free/pilot tiers are always excluded. Continue?")
        : true;
      if (!ok) return;
      ctx.onAutopilotModeChange("active");
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(DEFAULT_OUTPUT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as DefaultOutputOption;
        if (parsed && typeof parsed.kind === "string") setDefaultOutput(parsed);
      }
    } catch { /* noop */ }
  }, []);
  const persistOutput = (o: DefaultOutputOption) => {
    setDefaultOutput(o);
    try { window.localStorage.setItem(DEFAULT_OUTPUT_KEY, JSON.stringify(o)); } catch { /* noop */ }
  };

  useEffect(() => {
    if (typeof window === "undefined" || !window.electronAPI) return;
    void window.electronAPI.screens.list().then((list) => {
      setDisplays(list || []);
      try {
        const raw = window.localStorage.getItem(PREVIEW_DISPLAY_KEY);
        if (raw) setPreviewDisplay(parseInt(raw, 10));
      } catch { /* noop */ }
    });
  }, []);

  // Cmd/Ctrl+K is centralized in useOperatorHotkeys (Priority 4). The shell
  // fires a `presentflow:open-search` custom event which we listen for here
  // — that keeps a single source of truth for the keybind AND lets other
  // callers (e.g. Search icon button) still open the palette locally.
  useEffect(() => {
    const onOpen = () => setSearchOpen(true);
    window.addEventListener("presentflow:open-search", onOpen);
    return () => window.removeEventListener("presentflow:open-search", onOpen);
  }, []);

  const toggleMode = (m: CenterMode) => () =>
    onCenterMode(centerMode === m ? "slides" : m);

  const currentDisplay = displays.find((d) => d.id === previewDisplay) ?? displays[0];
  const displayLabel = currentDisplay ? `Screen ${currentDisplay.id}` : "No screen";

  return (
    <div className="h-11 shrink-0 border-b border-[var(--color-border)] bg-[var(--color-panel)] flex items-center px-2 gap-1">
      {/* Prominent search input (Task A) — read-only proxy for the SearchPalette. */}
      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        aria-label="Open search (Cmd+K)"
        className="group flex items-center h-[28px] w-[240px] rounded-md border border-[var(--color-border)] bg-[var(--color-app-bg)] hover:border-[var(--color-muted-foreground)] transition-colors px-2 gap-1.5 shrink-0"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        <Search className="w-4 h-4 text-[var(--color-muted-foreground)] shrink-0" />
        <span className="flex-1 text-left text-[12px] text-[var(--color-muted-foreground)] truncate">
          Search lyrics, songs, Bible, media…
        </span>
        <kbd className="text-[9px] font-mono px-1 py-[1px] rounded border border-[var(--color-border)] text-[var(--color-muted-foreground)] shrink-0">
          ⌘K
        </kbd>
      </button>
      <div className="mx-1 h-5 w-px bg-[var(--color-border)]" aria-hidden />
      <div className="flex items-center" style={{ gap: 4 }}>
        {/* Content cluster */}
        {/* 2026-07-25 field bug fix — was `ctx.onSendToLive` unconditionally
            which sends the PLAYLIST preview slide; in Bible/Songs modes
            that either fires the wrong slide or silently no-ops. Now
            routes to the same context-aware handlers as the CenterHeader
            Play button so both act on what the operator is looking at. */}
        <IconBtn
          icon={Play}
          label="Show current"
          onClick={() => {
            try { console.log("[topbar-play] clicked", { centerMode }); } catch { /* ignore */ }
            if (centerMode === "bible") {
              dispatchInternal("presentflow:bible-play-current");
              return;
            }
            if (centerMode === "songs") {
              dispatchInternal("presentflow:songs-play-current");
              return;
            }
            ctx.onSendToLive();
          }}
        />
      </div>

      <div className="mx-2 h-6 w-px bg-[var(--color-border)]" />
      <div className="flex items-center gap-1">
        <ModeBtn icon={Music} label="Songs" active={centerMode === "songs"} onClick={toggleMode("songs")} />
        <ModeBtn icon={BookOpen} label="Bible" active={centerMode === "bible"} onClick={toggleMode("bible")} emphasized />
        <ModeBtn icon={ImageIcon} label="Media" active={centerMode === "media"} onClick={toggleMode("media")} />
        <ModeBtn
          icon={Palette}
          label="Themes"
          active={false}
          onClick={() => window.dispatchEvent(new CustomEvent("presentflow:open-themes-settings"))}
        />
      </div>

      <div className="flex-1 flex items-center justify-center text-[13px] text-[var(--color-muted-foreground)] truncate px-4">
        {currentTitle}
      </div>

      <div className="flex items-center gap-0.5">
        {tier !== null && !canProContent && (
          <Popover.Root>
            <Popover.Trigger asChild>
              <button
                type="button"
                title="ProContent — Max upgrade"
                aria-label="ProContent"
                className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-white/5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
              >
                <Sparkles className="w-4 h-4" />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                side="bottom"
                align="end"
                sideOffset={4}
                className="w-[300px] rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-3 text-[12px] shadow-xl z-50"
              >
                <MaxUpgradePrompt feature="pro-content" variant="card" />
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        )}
        {/* Task F — Max-gated default output profile dropdown. */}
        {canProContent ? (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                title="Default output profile"
                className="flex items-center gap-1 h-[22px] px-1.5 rounded-md border border-[var(--color-border)] text-[11px] text-[var(--color-muted-foreground)] hover:bg-white/5 hover:text-[var(--color-foreground)]"
              >
                <span>{labelForOutput(defaultOutput)}</span>
                <ChevronDown className="w-3 h-3" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={4}
                className="rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-1 text-[12px] shadow-lg z-50 min-w-[180px]"
              >
                <DropdownMenu.Item onSelect={() => persistOutput({ kind: "default" })} className="px-3 py-1.5 rounded hover:bg-white/5 outline-none cursor-pointer">Default</DropdownMenu.Item>
                <DropdownMenu.Item onSelect={() => persistOutput({ kind: "in-house" })} className="px-3 py-1.5 rounded hover:bg-white/5 outline-none cursor-pointer">In-house Stream</DropdownMenu.Item>
                <DropdownMenu.Item onSelect={() => persistOutput({ kind: "livestream" })} className="px-3 py-1.5 rounded hover:bg-white/5 outline-none cursor-pointer">Livestream</DropdownMenu.Item>
                <DropdownMenu.Separator className="h-px bg-[var(--color-border)] my-1" />
                <DropdownMenu.Item onSelect={(e) => { e.preventDefault(); setCustomDialogOpen(true); }} className="px-3 py-1.5 rounded hover:bg-white/5 outline-none cursor-pointer">Custom…</DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        ) : (
          <Popover.Root open={maxPromptOpen} onOpenChange={setMaxPromptOpen}>
            <Popover.Trigger asChild>
              <button
                type="button"
                title="Default output profile — Max feature"
                className="flex items-center gap-1 h-[22px] px-1.5 rounded-md border border-[var(--color-border)] text-[11px] text-[var(--color-muted-foreground)] opacity-60 hover:opacity-100 hover:bg-white/5"
              >
                <span>{labelForOutput(defaultOutput)}</span>
                <ChevronDown className="w-3 h-3" />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                side="bottom"
                align="end"
                sideOffset={4}
                className="w-[280px] rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-3 text-[12px] shadow-xl z-50"
              >
                <MaxUpgradePrompt feature="pro-content" variant="card" />
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        )}
        {customDialogOpen && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
            role="dialog"
            aria-modal="true"
            onClick={() => setCustomDialogOpen(false)}
          >
            <div
              className="w-[320px] rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-[13px] font-medium mb-2">Custom output profile</div>
              <input
                autoFocus
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="Profile name"
                className="w-full h-8 px-2 rounded-md border border-[var(--color-border)] bg-[var(--color-app-bg)] text-[12px]"
              />
              <div className="mt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setCustomDialogOpen(false)} className="px-2 h-7 rounded-md text-[11px] hover:bg-white/5">Cancel</button>
                <button
                  type="button"
                  disabled={!customName.trim()}
                  onClick={() => {
                    persistOutput({ kind: "custom", name: customName.trim() });
                    setCustomDialogOpen(false);
                    setCustomName("");
                  }}
                  className="px-2 h-7 rounded-md text-[11px] border border-[var(--color-brand)] text-[var(--color-brand)] disabled:opacity-50"
                >Save</button>
              </div>
            </div>
          </div>
        )}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              title="Preview output display"
              className="px-2 h-8 flex items-center gap-1 text-[11px] font-mono uppercase tracking-wider text-[var(--color-muted-foreground)] rounded-md border border-[var(--color-border)] hover:bg-white/5"
            >
              {displayLabel} <ChevronDown className="w-3 h-3" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className="rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-1 text-[12px] shadow-lg z-50 min-w-[160px]"
            >
              {displays.length === 0 && (
                <div className="px-3 py-1.5 text-[var(--color-muted-foreground)]">No displays detected</div>
              )}
              {displays.map((d) => (
                <DropdownMenu.Item
                  key={d.id}
                  onSelect={() => {
                    setPreviewDisplay(d.id);
                    try { window.localStorage.setItem(PREVIEW_DISPLAY_KEY, String(d.id)); } catch { /* noop */ }
                  }}
                  className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer flex items-center justify-between"
                >
                  <span>Screen {d.id}</span>
                  <span className="text-[10px] opacity-60 font-mono">{d.bounds?.width}×{d.bounds?.height}</span>
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        {/* Big-bright AI Live pill — prominent OFF/CONNECTING/LIVE/OFFLINE indicator.
            Sits BEFORE the Live/Audience/Stage pills so operators can spot AI
            state at a glance. When errored, the pill splits into a status
            chip + inline Retry button. */}
        <Tooltip.Provider delayDuration={200}>
          <div className="flex items-center gap-1">
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button
                  type="button"
                  onClick={ctx.onListenToggle}
                  aria-pressed={listening}
                  aria-label={aiTitle}
                  className={cn(
                    "flex items-center gap-1.5 h-[28px] min-w-[90px] px-2 rounded-full border text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]",
                    listening
                      ? "bg-green-500/20 text-green-200 border-green-500/50 hover:bg-green-500/25"
                      : "bg-red-500/15 text-red-300 border-red-500/40 hover:bg-red-500/25",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "inline-block w-2 h-2 rounded-full shrink-0",
                      listening ? "bg-green-400" : "bg-red-500",
                    )}
                  />
                  <span className="truncate">{listening ? "AI ON" : "AI OFF"}</span>
                </button>
              </Tooltip.Trigger>
              {/* SR-only live region so screen readers announce the binary
                  ON ↔ OFF transition. The pill button's own aria-label
                  changes but AT clients don't re-announce name changes on
                  unmoved focus — a polite live region does. */}
              <span role="status" aria-live="polite" className="sr-only">{aiTitle}</span>
              <Tooltip.Portal>
                <Tooltip.Content
                  sideOffset={6}
                  className="rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] px-2 py-1 text-[11px] z-50 font-mono max-w-[260px]"
                >
                  {aiHardFailed ? "AI listener couldn't connect — Retry or Diagnose" : listening ? "AI is ON" : "AI is OFF — click to turn on"}
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
            {/* Reconnecting spinner removed 2026-07-24 — see comment above the
                `listening` declaration for the rationale. Binary pill only. */}
            {/* 2026-07-25 heartbeat dot — product-owner-requested revision of
                the "binary pill only" rule above: the pill still shows only
                intent, but this separate dot answers "is Deepgram actually
                hearing and transcribing RIGHT NOW?" after field reports of
                AI silently dying while the pill stayed green.
                  green pulse = socket ready + transcripts within 10s
                  amber       = socket ready but no transcripts in 10s
                                (mic muted / silence / wrong device)
                  red         = listening but pipeline down (reconnecting,
                                no audio signal, or device gone)
                  grey        = AI off */}
            {(() => {
              const lastAt = ctx.audio.lastTranscriptAt;
              // reconnectFailed outranks !listening (stress review follow-up):
              // a give-up flips listening=false, and a grey dot there reads
              // as "operator turned it off" when the truth is "it died".
              // JPD Fix 4 (2026-07-27): noAudioSignal no longer maps to
              // "down" (red). Field report — during natural service pauses
              // (prayer, communion) the input goes pure-silent for 15s+,
              // noAudioSignal flips, and the red dot read as "AI turned
              // itself off", so operators toggled it. The pipeline is fully
              // healthy during silence (always-on mode never tears down);
              // red is reserved for a genuinely down pipeline (!ready /
              // reconnect exhausted). Silence shows amber "quiet" with a
              // label that says explicitly the AI is still ON.
              const beat: "off" | "down" | "quiet" | "flowing" = ctx.audio.reconnectFailed
                ? "down"
                : !listening
                  ? "off"
                  : !ctx.audio.ready
                    ? "down"
                    : ctx.audio.noAudioSignal
                      ? "quiet"
                      : (typeof lastAt === "number" && heartbeatNow - lastAt < 10_000)
                        ? "flowing"
                        : "quiet";
              const label = beat === "off" ? "AI is off"
                : beat === "down" ? "AI pipeline down — audio isn't reaching transcription (reconnecting or no signal)"
                : beat === "quiet"
                  ? (ctx.audio.noAudioSignal
                    ? "AI is still ON — the room is silent right now (no signal for 15s+). It will resume detecting the moment speech returns. If someone IS speaking, check the mic/mixer routing."
                    : "Connected, but no speech transcribed in the last 10s — check the mic is unmuted and someone is speaking")
                : "AI healthy — audio flowing and transcripts arriving";
              return (
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    {/* role="img" not role="status" (reviewer 🟡): a live
                        region would re-announce every quiet↔flowing flap
                        during normal speech pauses — constant SR chatter.
                        The label is read on focus; state changes stay silent. */}
                    <span
                      role="img"
                      aria-label={`AI heartbeat: ${label}`}
                      data-testid="ai-heartbeat-dot"
                      tabIndex={0}
                      className="flex items-center justify-center w-4 h-4 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "inline-block w-2.5 h-2.5 rounded-full",
                          beat === "flowing" && "bg-green-400 animate-pulse",
                          beat === "quiet" && "bg-amber-400",
                          beat === "down" && "bg-red-500",
                          beat === "off" && "bg-zinc-600",
                        )}
                      />
                    </span>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      sideOffset={6}
                      className="rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] px-2 py-1 text-[11px] z-50 font-mono max-w-[280px]"
                    >
                      {label}
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
              );
            })()}
            {/* Roadmap #1 — audio-quality chip. Only renders when the rolling
                confidence window has dropped below the "low" threshold in
                useAudioStream, so it's invisible during normal use. When it
                appears, it tells the operator the AI's misfires are audio
                quality (mic muffled, room echo, distance) rather than an AI
                bug. Sits BETWEEN AI ON pill and AUTO toggle. */}
            {/* Mini live audio level meter — sits directly next to the AI ON
                pill so the operator can eyeball at a glance that audio is
                actually flowing. Only shown while listening. 60px wide,
                6px tall bar with a smooth green→amber→red fill. Reads the
                throttled `audioLevel` (0..1) exposed by useAudioStream. */}
            {listening && (() => {
              // 🟡 Stress F5 fix — mic-audio flows locally even while the
              // Fly WebSocket bridge is disconnected, which made the meter
              // stay green during Deepgram outages (misleadingly reassuring).
              // Grey the meter + adjust tooltip whenever the pipeline isn't
              // healthy (not ready OR mid-reconnect) so the operator knows
              // audio is captured but nothing is reaching transcription.
              const pipelineHealthy = ctx.audio.ready && !ctx.audio.reconnectFailed && ctx.audio.reconnectAttempts === 0;
              const level = ctx.audio.audioLevel ?? 0;
              const fillColor = !pipelineHealthy
                ? "#6b7280" // grey — bridge down; audio is local-only
                : level > 0.9
                  ? "#e11d48"
                  : level > 0.6
                    ? "#f59e0b"
                    : level > 0.05
                      ? "#10b981"
                      : "#6b7280";
              const tooltipText = !pipelineHealthy
                ? "Audio is being captured locally, but the AI pipeline is disconnected. Verse detection is paused until it reconnects."
                : "Live audio input level. If this bar stays flat while the preacher is talking, PresentFlow isn't hearing your mixer — check Settings › Audio › Source Type is set to Mixer / Interface and the right device is picked.";
              return (
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <div
                      role="meter"
                      aria-label="Audio input level"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(level * 100)}
                      className="flex items-center h-[24px] px-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-panel)]"
                      data-testid="topbar-audio-meter"
                    >
                      <div className="relative w-[60px] h-[6px] rounded-full overflow-hidden bg-black/40">
                        <div
                          className="absolute inset-y-0 left-0 transition-[width] duration-100 ease-out"
                          style={{
                            width: `${Math.max(2, Math.round(level * 100))}%`,
                            background: fillColor,
                          }}
                        />
                      </div>
                    </div>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      sideOffset={6}
                      className="rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] px-2 py-1 text-[11px] z-50 font-mono max-w-[280px]"
                    >
                      {tooltipText}
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
              );
            })()}
            {listening && ctx.audio.audioQuality === "low" && (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <span
                    role="status"
                    aria-live="polite"
                    className="flex items-center gap-1 h-[24px] px-2 rounded-full border text-[10px] font-semibold uppercase tracking-wider bg-amber-500/15 text-amber-200 border-amber-500/50"
                    data-testid="audio-quality-low"
                  >
                    <span aria-hidden className="inline-block w-2 h-2 rounded-full bg-amber-400" />
                    <span>LOW AUDIO</span>
                    <span className="text-[9px] font-mono opacity-60">{Math.round((ctx.audio.audioQualityAvg ?? 0) * 100)}%</span>
                  </span>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    sideOffset={6}
                    className="rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] px-2 py-1 text-[11px] z-50 font-mono max-w-[280px]"
                  >
                    Recent transcription confidence is low ({Math.round((ctx.audio.audioQualityAvg ?? 0) * 100)}%). Check mic position, room echo, or preacher distance. AI misfires right now are likely a signal problem, not a model error.
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            )}
            {/* WS1 — music/choir chip. Auto-projection is HELD (stage+confirm)
                while the feed looks like worship/music, so the app doesn't
                mis-fire on singing. Distinct amber-violet from LOW AUDIO. */}
            {listening && ctx.audio.musicSuspected && (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <span
                    role="status"
                    aria-live="polite"
                    className="flex items-center gap-1 h-[24px] px-2 rounded-full border text-[10px] font-semibold uppercase tracking-wider bg-violet-500/15 text-violet-200 border-violet-500/50"
                    data-testid="audio-music-suspected"
                  >
                    <span aria-hidden className="inline-block w-2 h-2 rounded-full bg-violet-400" />
                    <span>MUSIC</span>
                  </span>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    sideOffset={6}
                    className="rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] px-2 py-1 text-[11px] z-50 font-mono max-w-[280px]"
                  >
                    Worship / music detected (strong signal, low speech confidence). Auto-projection is paused so the app won&apos;t mis-fire on singing — detections still show, press the confirm key to project. Clears automatically when clear speech returns.
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            )}
            {/* WS2 — clipping / over-drive chip. The feed is too hot (peaking at
                0 dBFS); ASR garbles clipped audio. Red = act now. */}
            {listening && ctx.audio.clipping && (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <span
                    role="status"
                    aria-live="polite"
                    className="flex items-center gap-1 h-[24px] px-2 rounded-full border text-[10px] font-semibold uppercase tracking-wider bg-red-500/15 text-red-200 border-red-500/50"
                    data-testid="audio-clipping"
                  >
                    <span aria-hidden className="inline-block w-2 h-2 rounded-full bg-red-400" />
                    <span>AUDIO TOO HOT</span>
                  </span>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    sideOffset={6}
                    className="rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] px-2 py-1 text-[11px] z-50 font-mono max-w-[280px]"
                  >
                    The incoming audio is clipping (peaking at maximum). A clipped feed transcribes badly. Lower the send level to PresentFlow from the mixer/desk (or the input gain) until this clears.
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            )}
            {/* #4 — Big Auto-approve toggle. Sits next to the AI Live pill so
                operators can spot the mode at a glance. */}
            <button
              type="button"
              role="switch"
              aria-checked={autoApproveOn}
              onClick={toggleAutoApprove}
              title={autoApproveOn ? "Auto-approve is ON — high-confidence detections auto-send to LIVE" : "Auto-approve is OFF — click chips to send"}
              className={cn(
                "relative flex items-center gap-1.5 h-[28px] w-[100px] px-2 rounded-full border text-[10px] font-bold uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]",
                autoApproveOn
                  ? "bg-[var(--color-brand)] text-white border-[var(--color-brand)] hover:brightness-110"
                  : "bg-[var(--color-panel)] text-[var(--color-muted-foreground)] border-[var(--color-border)] hover:bg-white/5",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "inline-block w-3 h-3 rounded-full shrink-0 transition-transform",
                  autoApproveOn ? "bg-white translate-x-0" : "bg-[var(--color-muted-foreground)]",
                )}
              />
              <span className="truncate">{autoApproveOn ? "AUTO" : "Manual"}</span>
            </button>
            {/* B3 — projector text-size control. AUTO = auto-fit; A−/A+ bias the
                fitted size (clamped so text never runs off-screen). */}
            <div
              className="flex items-center gap-0.5 h-[28px] rounded-full border border-[var(--color-border)] bg-[var(--color-panel)] px-1"
              title="Projector text size — AUTO fits automatically; A− / A+ make it smaller / larger"
            >
              <button
                type="button"
                onClick={() => changeFontScale(fontScale - FONT_SCALE_STEP)}
                disabled={fontScale <= FONT_SCALE_MIN + 1e-6}
                aria-label="Smaller projected text"
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/5 text-[var(--color-brand)] disabled:opacity-40 text-[13px] font-bold leading-none"
              >
                A−
              </button>
              <button
                type="button"
                onClick={() => changeFontScale(1)}
                title="Reset to AUTO (auto-fit)"
                className={cn(
                  "h-6 min-w-[42px] px-1 rounded text-[9px] font-bold uppercase tracking-wider leading-none",
                  fontIsAuto ? "text-[var(--color-brand)]" : "text-[var(--color-muted-foreground)] hover:bg-white/5",
                )}
              >
                {fontIsAuto ? "AUTO" : `${Math.round(fontScale * 100)}%`}
              </button>
              <button
                type="button"
                onClick={() => changeFontScale(fontScale + FONT_SCALE_STEP)}
                disabled={fontScale >= FONT_SCALE_MAX - 1e-6}
                aria-label="Larger projected text"
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/5 text-[var(--color-brand)] disabled:opacity-40 text-[13px] font-bold leading-none"
              >
                A+
              </button>
            </div>
            {aiHardFailed && (
              <>
                <button
                  type="button"
                  onClick={() => { if (ctx.onResumeAudio) ctx.onResumeAudio(); else ctx.onListenToggle(); }}
                  title="Retry AI listener"
                  aria-label="Retry AI listener"
                  className="h-[24px] px-2 rounded-md text-[10px] font-semibold bg-red-500/20 text-red-100 border border-red-500/50 hover:bg-red-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
                >Retry</button>
                <button
                  type="button"
                  onClick={() => setDiagOpen(true)}
                  title="Run AI listener diagnostic — traces each pipeline step"
                  aria-label="Diagnose AI listener"
                  className="h-[24px] px-2 rounded-md text-[10px] font-semibold bg-amber-500/20 text-amber-100 border border-amber-500/50 hover:bg-amber-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
                >Diagnose</button>
              </>
            )}
            {/* Manual "Restart AI listener" ↻ button removed 2026-07-24.
                It was a persistent icon next to the AI pill that read as
                "AI is churning / interfering" the same way the removed
                reconnecting spinner did. Operators wanting to manually
                restart the listener can toggle the AI ON pill OFF then ON —
                same effect (full teardown + fresh ticket + start), one less
                visual pattern near the binary pill.
                The IPC handler (presentflow:restart-audio window event) is
                intentionally kept live so a future settings-panel button or
                keyboard shortcut can still trigger it without cluttering
                the top bar. */}
          </div>
        </Tooltip.Provider>
        {/* Task F — PP-parity output pills */}
        <button
          type="button"
          title={isLive ? "LIVE — click to scroll preview" : "Live output cleared"}
          onClick={() => {
            const el = document.querySelector('[data-tour="right"]');
            if (el && "scrollIntoView" in el) (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "nearest" });
          }}
          className={cn(
            "flex items-center gap-1 h-[22px] px-1.5 rounded-md text-[10px] font-medium border transition-colors",
            isLive
              ? "border-[var(--color-destructive)] bg-[color-mix(in_srgb,var(--color-destructive)_15%,transparent)] text-[var(--color-destructive)]"
              : "border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-white/5",
          )}
        >
          <Circle className={cn("w-2 h-2", isLive ? "fill-[var(--color-destructive)] text-[var(--color-destructive)]" : "fill-[var(--color-muted-foreground)] text-[var(--color-muted-foreground)]")} />
          <span>Live</span>
        </button>
        <div
          className={cn(
            "flex items-center gap-1 h-[22px] px-1.5 rounded-md text-[10px] font-medium border",
            displays.length > 1
              ? "border-[var(--color-success)] text-[var(--color-success)] bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)]"
              : "border-[var(--color-border)] text-[var(--color-muted-foreground)]",
          )}
          title={`Audience output — ${displays.length > 1 ? "available" : "single display"}`}
        >
          <Circle className={cn("w-2 h-2", displays.length > 1 ? "fill-[var(--color-success)] text-[var(--color-success)]" : "fill-[var(--color-muted-foreground)] text-[var(--color-muted-foreground)]")} />
          <span className="hidden sm:inline">Audience</span>
          <MonitorSpeaker className="w-3 h-3 sm:hidden" />
        </div>
        <div
          className={cn(
            "flex items-center gap-1 h-[22px] px-1.5 rounded-md text-[10px] font-medium border",
            displays.length > 2
              ? "border-[var(--color-success)] text-[var(--color-success)] bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)]"
              : "border-[var(--color-border)] text-[var(--color-muted-foreground)]",
          )}
          title={`Stage output — ${displays.length > 2 ? "available" : "not assigned"}`}
        >
          <Circle className={cn("w-2 h-2", displays.length > 2 ? "fill-[var(--color-success)] text-[var(--color-success)]" : "fill-[var(--color-muted-foreground)] text-[var(--color-muted-foreground)]")} />
          <span className="hidden sm:inline">Stage</span>
          <ScreenShare className="w-3 h-3 sm:hidden" />
        </div>
        {/* Task G — Present Flow logo */}
        <Popover.Root>
          <Popover.Trigger asChild>
            <button
              type="button"
              aria-label="Present Flow"
              className="ml-1 flex items-center gap-1 h-[22px] px-1.5 rounded-md hover:bg-white/5"
              title="Present Flow"
            >
              <Image
                src="/brand/pf-logo-mark.png"
                alt="Present Flow"
                width={20}
                height={20}
                className="w-[20px] h-[20px] object-contain"
              />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              side="bottom"
              align="end"
              sideOffset={4}
              className="rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-3 text-[12px] shadow-xl z-50 w-[220px]"
            >
              <div className="font-semibold text-[13px]" style={{ color: "var(--color-brand)", fontFamily: "var(--font-display)" }}>
                Present Flow
              </div>
              <div className="mt-1 text-[11px] text-[var(--color-muted-foreground)] font-mono">v0.1.0</div>
              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent("presentflow:open-tour"));
                }}
                className="mt-2 text-[11px] text-[var(--color-brand)] hover:underline block"
              >
                About / Guided tour
              </button>
              <button
                type="button"
                onClick={() => setDiagOpen(true)}
                className="mt-1 text-[11px] text-[var(--color-brand)] hover:underline block"
              >
                Diagnose AI listener
              </button>
              <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const mod = await import("@/lib/sign-out");
                      await mod.signOutFully("/login");
                    } catch {
                      // Fallback: nav directly to a sign-out URL if the module fails.
                      try { window.location.href = "/api/auth/signout?callbackUrl=/login"; } catch { /* noop */ }
                    }
                  }}
                  className="w-full h-8 rounded-md border border-red-500/40 text-[11px] font-semibold text-red-300 hover:bg-red-500/10 hover:border-red-500/60"
                >
                  Log out
                </button>
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>

      <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} ctx={ctx} onCenterMode={onCenterMode} />
      <AIDiagnosticModal
        planId={ctx.planId}
        open={diagOpen}
        onOpenChange={setDiagOpen}
        live={!diagOpen ? undefined : ((): LiveAudioStats => {
          // Best-effort input name from the persisted native-device pref; NDI
          // sources are named "NDI: <source>" so we can label the transport.
          // Only computed while the modal is open (avoids a per-render
          // localStorage read/parse — review G5).
          let inputName: string | null = null;
          let transport: string | null = null;
          try {
            const np = readNativeDevicePref();
            if (np?.name) {
              inputName = np.name;
              transport = /^NDI:/i.test(np.name) ? "ndi" : "native";
            }
          } catch { /* noop */ }
          return {
            inputName,
            transport,
            listening: ctx.audio.listening,
            ready: ctx.audio.ready,
            stage: ctx.audio.stage,
            sampleRate: ctx.audio.streamSampleRate,
            channels: ctx.audio.streamChannelCount,
            level: ctx.audio.audioLevel,
            quality: ctx.audio.audioQuality,
            qualityAvg: ctx.audio.audioQualityAvg,
            avgConfidence: ctx.audio.avgConfidence,
            musicSuspected: ctx.audio.musicSuspected,
            clipping: ctx.audio.clipping,
            noAudioSignal: ctx.audio.noAudioSignal,
            reconnectAttempts: ctx.audio.reconnectAttempts,
            msgsPerSec: ctx.audio.msgsPerSec,
            lastLatencyMs: ctx.audio.lastLatencyMs,
            error: ctx.audio.error,
          };
        })()}
      />
    </div>
  );
}
