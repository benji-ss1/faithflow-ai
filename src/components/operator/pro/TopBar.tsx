"use client";
import { useEffect, useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import { useTier } from "@/hooks/useTier";
import { MaxUpgradePrompt } from "@/components/tier/MaxUpgradePrompt";
import {
  Search, Type, Palette, LayoutGrid, Play, Pencil, Repeat, BookOpen,
  MoreHorizontal, Sparkles, Image as ImageIcon, MonitorSpeaker, Circle, Radio, ScreenShare,
  Music, Printer, Copy, ChevronDown,
} from "lucide-react";
import type { OperatorShellCtx } from "../shell/types";
import type { CenterMode } from "./ProOperatorShell";
import { cn } from "@/lib/utils";
import { SearchPalette } from "./SearchPalette";
import type { DisplayInfo } from "@/types/electron";

function IconBtn({
  icon: Icon, label, active, onClick, todo,
}: { icon: typeof Search; label: string; active?: boolean; onClick?: () => void; todo?: boolean }) {
  return (
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            data-todo={todo ? "1" : undefined}
            onClick={onClick}
            disabled={todo && !onClick}
            title={todo ? `${label} — coming soon` : label}
            className={cn(
              "w-8 h-8 flex items-center justify-center rounded-md transition-colors",
              "hover:bg-[var(--color-elevated)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
              active && "text-[var(--color-foreground)] border-b-2 border-[var(--color-brand)] rounded-b-none",
              todo && !onClick && "opacity-50 cursor-not-allowed",
            )}
            aria-label={label}
          >
            <Icon className="w-[18px] h-[18px]" />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content sideOffset={4} className="rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] px-2 py-1 text-[11px] z-50">
            {label}{todo ? " — coming soon" : ""}
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
          : "bg-transparent text-[var(--color-muted-foreground)] border-[var(--color-border)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-elevated)]",
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
  const aiDotClass = aiError
    ? "text-[var(--color-destructive)]"
    : listening && aiReady && aiFlowing
    ? "text-[var(--color-ai-listening)]"
    : listening
    ? "text-[var(--color-warning,#f5a524)]"
    : "text-[var(--color-muted-foreground)]";
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
  const { isMax } = useTier();
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [previewDisplay, setPreviewDisplay] = useState<number | null>(null);

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
      <div className="flex items-center gap-0.5">
        <IconBtn icon={Search} label="Search (Cmd+K)" onClick={() => setSearchOpen(true)} />
        <IconBtn icon={Type} label="Text" todo />
        <IconBtn icon={Palette} label="Theme" todo />
        <IconBtn icon={LayoutGrid} label="Arrangement" todo />
        <IconBtn icon={Play} label="Show" onClick={ctx.onSendToLive} />
        <IconBtn icon={Pencil} label="Edit" todo />
        <IconBtn icon={Repeat} label="Reflow" todo />
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
              className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-[var(--color-elevated)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
              aria-label="More actions"
            >
              <MoreHorizontal className="w-[18px] h-[18px]" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="start"
              sideOffset={4}
              className="rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-1 text-[12px] shadow-lg z-50 min-w-[180px]"
            >
              <DropdownMenu.Item
                disabled
                className="px-3 py-1.5 rounded opacity-50 cursor-not-allowed"
                title="Export — coming soon"
              >
                Export…
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => window.print()}
                className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none flex items-center gap-2 cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" /> Print
              </DropdownMenu.Item>
              <DropdownMenu.Item
                disabled
                className="px-3 py-1.5 rounded opacity-50 cursor-not-allowed flex items-center gap-2"
                title="Duplicate slide — coming soon"
              >
                <Copy className="w-3.5 h-3.5" /> Duplicate slide
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => alert(`PresentFlow Pro\nCenter: ${centerMode}\nLive: ${isLive ? "on" : "off"}\nDisplays: ${displays.length}\nAI: ${listening ? "listening" : "idle"}`)}
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
        <Popover.Root>
          <Popover.Trigger asChild>
            <button
              type="button"
              title="ProContent"
              aria-label="ProContent"
              className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-[var(--color-elevated)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            >
              <Sparkles className="w-[18px] h-[18px]" />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              side="bottom"
              align="end"
              sideOffset={4}
              className="w-[300px] rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-3 text-[12px] shadow-xl z-50"
            >
              {isMax ? (
                <div className="text-[var(--color-muted-foreground)]">
                  Coming soon — Max content marketplace.
                </div>
              ) : (
                <MaxUpgradePrompt feature="pro-content" variant="card" />
              )}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
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
              className="px-2 h-8 flex items-center gap-1 text-[11px] font-mono uppercase tracking-wider text-[var(--color-muted-foreground)] rounded-md border border-[var(--color-border)] hover:bg-[var(--color-elevated)]"
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
        <div className="flex items-center gap-1 px-2 h-8" title={isLive ? "LIVE" : "Cleared"}>
          <Circle className={cn("w-2.5 h-2.5", isLive ? "fill-[var(--color-destructive)] text-[var(--color-destructive)]" : "fill-[var(--color-muted-foreground)] text-[var(--color-muted-foreground)]")} />
          <span className="text-[10px] font-mono uppercase tracking-wider">Live</span>
        </div>
        <div className="flex items-center gap-1 px-1" title={`Audience output — ${displays.length > 1 ? "available" : "single display"}`}>
          <MonitorSpeaker className={cn("w-4 h-4", displays.length > 1 ? "text-[var(--color-success)]" : "text-[var(--color-muted-foreground)]")} />
        </div>
        <div className="flex items-center gap-1 px-1" title={`Stage output — ${displays.length > 2 ? "available" : "not assigned"}`}>
          <ScreenShare className={cn("w-4 h-4", displays.length > 2 ? "text-[var(--color-success)]" : "text-[var(--color-muted-foreground)]")} />
        </div>
        <button
          type="button"
          onClick={ctx.onListenToggle}
          title={aiTitle}
          className="flex items-center gap-1 px-1 rounded hover:bg-[var(--color-elevated)]"
        >
          <Radio className={cn("w-4 h-4", aiDotClass)} />
        </button>
      </div>

      <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} ctx={ctx} onCenterMode={onCenterMode} />
    </div>
  );
}
