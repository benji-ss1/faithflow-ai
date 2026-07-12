"use client";
import * as Tooltip from "@radix-ui/react-tooltip";
import {
  Search, Type, Palette, LayoutGrid, Play, Pencil, Repeat, BookOpen,
  MoreHorizontal, Sparkles, Image as ImageIcon, MonitorSpeaker, Circle, Radio, ScreenShare,
  Music,
} from "lucide-react";
import type { OperatorShellCtx } from "../shell/types";
import type { CenterMode } from "./ProOperatorShell";
import { cn } from "@/lib/utils";

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
            className={cn(
              "w-8 h-8 flex items-center justify-center rounded-md transition-colors",
              "hover:bg-[var(--color-elevated)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
              active && "text-[var(--color-foreground)] border-b-2 border-[var(--color-brand)] rounded-b-none",
            )}
            aria-label={label}
          >
            <Icon className="w-[18px] h-[18px]" />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content sideOffset={4} className="rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] px-2 py-1 text-[11px]">
            {label}{todo ? " (soon)" : ""}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

/**
 * Prominent labeled mode buttons — the demo-critical entry points for
 * Songs / Bible / Media. Bible is emphasized (brand accent + slightly
 * bolder label) since it's the highest-use mode in a service.
 * Each button toggles centerMode: clicking again while active returns
 * to the slides view.
 */
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

  const toggleMode = (m: CenterMode) => () =>
    onCenterMode(centerMode === m ? "slides" : m);

  return (
    <div className="h-11 shrink-0 border-b border-[var(--color-border)] bg-[var(--color-panel)] flex items-center px-2 gap-1">
      {/* Left icon group — auxiliary actions */}
      <div className="flex items-center gap-0.5">
        <IconBtn icon={Search} label="Search" todo />
        <IconBtn icon={Type} label="Text" todo />
        <IconBtn icon={Palette} label="Theme" todo />
        <IconBtn icon={LayoutGrid} label="Arrangement" todo />
        <IconBtn icon={Play} label="Show" onClick={ctx.onSendToLive} />
        <IconBtn icon={Pencil} label="Edit" todo />
        <IconBtn icon={Repeat} label="Reflow" todo />
      </div>

      {/* Prominent mode buttons — Songs / Bible / Media */}
      <div className="mx-2 h-6 w-px bg-[var(--color-border)]" />
      <div className="flex items-center gap-1">
        <ModeBtn
          icon={Music}
          label="Songs"
          active={centerMode === "songs"}
          onClick={toggleMode("songs")}
        />
        <ModeBtn
          icon={BookOpen}
          label="Bible"
          active={centerMode === "bible"}
          onClick={toggleMode("bible")}
          emphasized
        />
        <ModeBtn
          icon={ImageIcon}
          label="Media"
          active={centerMode === "media"}
          onClick={toggleMode("media")}
        />
      </div>
      <div className="mx-2 h-6 w-px bg-[var(--color-border)]" />

      <div className="flex items-center gap-0.5">
        <IconBtn icon={MoreHorizontal} label="More" todo />
      </div>

      {/* Center title */}
      <div className="flex-1 flex items-center justify-center text-[13px] text-[var(--color-muted-foreground)] truncate px-4">
        {currentTitle}
      </div>

      {/* Right group */}
      <div className="flex items-center gap-0.5">
        <IconBtn icon={Sparkles} label="ProContent" todo />
        <IconBtn
          icon={ImageIcon}
          label="Media browser"
          active={mediaStripOpen}
          onClick={onToggleMediaStrip}
        />
        <div className="mx-1 h-5 w-px bg-[var(--color-border)]" />
        <div className="px-2 h-8 flex items-center gap-1 text-[11px] font-mono uppercase tracking-wider text-[var(--color-muted-foreground)] rounded-md border border-[var(--color-border)]">
          Screen 1
        </div>
        {/* Live indicator */}
        <div className="flex items-center gap-1 px-2 h-8" title={isLive ? "LIVE" : "Cleared"}>
          <Circle className={cn("w-2.5 h-2.5", isLive ? "fill-[var(--color-destructive)] text-[var(--color-destructive)]" : "fill-[var(--color-muted-foreground)] text-[var(--color-muted-foreground)]")} />
          <span className="text-[10px] font-mono uppercase tracking-wider">Live</span>
        </div>
        {/* Audience / Stage / Status */}
        <div className="flex items-center gap-1 px-1" title="Audience output">
          <MonitorSpeaker className="w-4 h-4 text-[var(--color-muted-foreground)]" />
        </div>
        <div className="flex items-center gap-1 px-1" title="Stage output">
          <ScreenShare className="w-4 h-4 text-[var(--color-muted-foreground)]" />
        </div>
        {/* AI listening dot */}
        <div className="flex items-center gap-1 px-1" title={listening ? "AI listening" : "AI idle"}>
          <Radio className={cn("w-4 h-4", listening ? "text-[var(--color-ai-listening)]" : "text-[var(--color-muted-foreground)]")} />
        </div>
        {/* Status */}
        <div className="w-2 h-2 rounded-full bg-[var(--color-success)]" title="Healthy" />
      </div>
    </div>
  );
}
