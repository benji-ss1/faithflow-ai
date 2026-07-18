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
  MoreHorizontal, Sparkles, Image as ImageIcon, MonitorSpeaker, Circle, ScreenShare,
  Music, Printer, ChevronDown,
} from "lucide-react";
import Image from "next/image";
import type { OperatorShellCtx } from "../shell/types";
import type { CenterMode } from "./ProOperatorShell";
import { cn } from "@/lib/utils";
import { SearchPalette } from "./SearchPalette";
import { AIDiagnosticModal } from "../AIDiagnosticModal";
import type { DisplayInfo } from "@/types/electron";

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
  const listening = ctx.audio.listening;
  const aiError = ctx.audio.error;
  const aiReady = ctx.audio.ready;
  // R1: green only when transcripts are actually flowing — mic-muted operators
  // will otherwise see a green dot despite silence. Amber during handshake or
  // when Deepgram is ready but no messages have arrived yet.
  const aiFlowing = ctx.audio.dgMessagesReceived > 0
    || ctx.audio.stage === "receiving_interim"
    || ctx.audio.stage === "receiving_final";
  const aiTitle = aiError
    ? `AI error: ${aiError} — click to retry`
    : listening && aiReady && aiFlowing
    ? "AI listening — click to stop"
    : listening && aiReady
    ? "AI ready — waiting for audio"
    : listening
    ? "AI connecting…"
    : "AI idle — click to start";

  const [searchOpen, setSearchOpen] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);
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
  useEffect(() => {
    // Y3: sessionStorage instead of localStorage. Cleared on tab close;
    // operator must re-arm each session — XSS-flipping the flag no longer
    // arms auto-live silently across restarts. We ALSO wipe the legacy
    // localStorage key so a compromised value there can't override.
    try {
      window.sessionStorage.setItem(AUTO_APPROVE_KEY, autoApproveOn ? "1" : "0");
      // Retire the legacy localStorage entry.
      window.localStorage.removeItem(AUTO_APPROVE_KEY);
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
        <IconBtn icon={Play} label="Show" onClick={ctx.onSendToLive} />
        <IconBtn
          icon={BookOpen}
          label="Bible"
          active={centerMode === "bible"}
          onClick={() => onCenterMode(centerMode === "bible" ? "slides" : "bible")}
        />
      </div>

      <div className="mx-2 h-6 w-px bg-[var(--color-border)]" />
      <div className="flex items-center gap-1">
        <ModeBtn icon={Music} label="Songs" active={centerMode === "songs"} onClick={toggleMode("songs")} />
        <ModeBtn icon={BookOpen} label="Bible" active={centerMode === "bible"} onClick={toggleMode("bible")} emphasized />
        <ModeBtn icon={ImageIcon} label="Media" active={centerMode === "media"} onClick={toggleMode("media")} />
      </div>
      <div className="mx-2 h-6 w-px bg-[var(--color-border)]" />

      <div className="flex items-center gap-0.5">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              title="More"
              className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-white/5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
              aria-label="More actions"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="start"
              sideOffset={4}
              className="rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-1 text-[12px] shadow-lg z-50 min-w-[180px]"
            >
              <DropdownMenu.Item
                onSelect={() => window.print()}
                className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none flex items-center gap-2 cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" /> Print
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => {
                  const info = `Center: ${centerMode} · Live: ${isLive ? "on" : "off"} · Displays: ${displays.length} · AI: ${listening ? "listening" : "idle"}`;
                  try { navigator.clipboard.writeText(info).catch(() => { /* noop */ }); } catch { /* noop */ }
                  toast.success("Diagnostics copied", { description: info });
                }}
                className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer"
              >
                Show diagnostics
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
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
        <IconBtn
          icon={ImageIcon}
          label="Media browser"
          active={mediaStripOpen}
          onClick={onToggleMediaStrip}
        />
        <div className="mx-1 h-5 w-px bg-[var(--color-border)]" />
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
                    aiError
                      ? "bg-red-600/25 text-red-100 border-red-500/70"
                      : listening && aiReady && aiFlowing
                      ? "bg-green-500/20 text-green-200 border-green-500/50 hover:bg-green-500/25"
                      : listening
                      ? "bg-amber-500/15 text-amber-200 border-amber-500/50 hover:bg-amber-500/25"
                      : "bg-red-500/15 text-red-300 border-red-500/40 hover:bg-red-500/25",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "inline-block w-2 h-2 rounded-full shrink-0",
                      aiError
                        ? "bg-red-500"
                        : listening && aiReady && aiFlowing
                        ? "bg-green-400 pf-ai-live-dot"
                        : listening
                        ? "bg-amber-400 pf-ai-connecting-dot"
                        : "bg-red-500",
                    )}
                  />
                  <span className="truncate">
                    {aiError
                      ? "AI Live · offline"
                      : listening && aiReady && aiFlowing
                      ? "AI Live"
                      : listening
                      ? "AI Live · connecting…"
                      : "AI Live"}
                  </span>
                  {aiError && (
                    <span
                      aria-hidden
                      title="Audio bridge unreachable — click Retry to reconnect"
                      className="ml-1 inline-flex items-center justify-center w-3 h-3 rounded-full bg-red-500/60 text-white text-[8px] font-bold"
                    >i</span>
                  )}
                </button>
              </Tooltip.Trigger>
              {/* SR-only live region so screen readers announce state
                  transitions (off → connecting → live → error). The pill
                  button's own aria-label changes but AT clients don't
                  re-announce name changes on unmoved focus — a polite live
                  region does. */}
              <span role="status" aria-live="polite" className="sr-only">{aiTitle}</span>
              <Tooltip.Portal>
                <Tooltip.Content
                  sideOffset={6}
                  className="rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] px-2 py-1 text-[11px] z-50 font-mono max-w-[260px]"
                >
                  {aiError ? aiError : `stage: ${ctx.audio.stage}`}
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
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
            {aiError && (
              <>
                <button
                  type="button"
                  onClick={() => { ctx.onResumeAudio?.() ?? ctx.onListenToggle(); }}
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
            {/* Task 6 — manual "Restart listening" icon. Full teardown +
                fresh ticket + start. Available whenever the pipeline is
                initialised (listening OR warm-started). */}
            {(listening || ctx.audio.warmStarted) && ctx.onRestartAudio && (
              <button
                type="button"
                onClick={() => ctx.onRestartAudio?.()}
                title="Restart AI listener"
                aria-label="Restart AI listener"
                data-testid="restart-audio-btn"
                className="h-[24px] w-[24px] rounded-md text-[13px] font-bold text-[var(--color-muted-foreground)] border border-[var(--color-border)] hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] flex items-center justify-center"
              >↻</button>
            )}
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
      <AIDiagnosticModal planId={ctx.planId} open={diagOpen} onOpenChange={setDiagOpen} />
    </div>
  );
}
