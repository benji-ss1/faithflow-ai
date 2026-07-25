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
 * - Settings → embeds the existing tab bodies (Audio, Messages, Timers,
 *   Themes, Macros) as a small sub-nav.
 * - Screens → embeds ScreensPanel (per-machine resolution + display
 *   assignment + Configure Screens button).
 */
import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { BookOpen, Music, Link2, ScrollText, Settings as SettingsIcon, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OperatorShellCtx } from "../../shell/types";
import type { TimerApi, MessagesApi } from "../hooks";
import type { UnifiedSuggestion } from "../../useAudioStream";
import { AIDetectionsPanel } from "./AIDetectionsPanel";
import { AudioTab } from "./tabs/AudioTab";
import { MessagesTab } from "./tabs/MessagesTab";
import { TimersTab } from "./tabs/TimersTab";
import { ThemesTab } from "./tabs/ThemesTab";
import { MacrosTab } from "./tabs/MacrosTab";
import { ScreensPanel } from "@/components/operator/screens/ScreensPanel";

type PopoverKey = "bible" | "songs" | "xrefs" | "logs" | "settings" | "screens";

export function RightIconBar({
  ctx, timer, messages,
}: {
  ctx: OperatorShellCtx;
  timer: TimerApi;
  messages: MessagesApi;
}) {
  const [openKey, setOpenKey] = useState<PopoverKey | null>(null);

  // Badge counts derived directly from live suggestion state — updates
  // reactively as detections land, no separate subscription needed.
  const bibleCount = ctx.audio.suggestions.filter((s: UnifiedSuggestion) => s.type === "scripture").length;
  const songCount = ctx.audio.suggestions.filter((s: UnifiedSuggestion) => s.type === "song" || s.type === "lyric").length;
  const xrefCount = ctx.audio.phraseMatches.length;

  return (
    <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-panel)]">
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
        <IconTrigger
          k="logs" openKey={openKey} setOpen={setOpenKey}
          Icon={ScrollText} label="Logs"
        />
        <IconTrigger
          k="settings" openKey={openKey} setOpen={setOpenKey}
          Icon={SettingsIcon} label="Settings"
        />
        <IconTrigger
          k="screens" openKey={openKey} setOpen={setOpenKey}
          Icon={Monitor} label="Screens"
        />
      </div>

      {/* Popovers ------------------------------------------------------- */}
      {openKey === "bible" && (
        <PopoverShell title="Bible detections" onClose={() => setOpenKey(null)}>
          <AIDetectionsPanel ctx={ctx} sections={["bible"]} />
        </PopoverShell>
      )}
      {openKey === "songs" && (
        <PopoverShell title="Song detections" onClose={() => setOpenKey(null)}>
          <AIDetectionsPanel ctx={ctx} sections={["songs"]} />
        </PopoverShell>
      )}
      {openKey === "xrefs" && (
        <PopoverShell title="Cross-references" onClose={() => setOpenKey(null)}>
          <AIDetectionsPanel ctx={ctx} sections={["xrefs"]} />
        </PopoverShell>
      )}
      {openKey === "logs" && (
        <PopoverShell title="Logs" onClose={() => setOpenKey(null)}>
          <div className="p-3 text-[11px] text-[var(--color-muted-foreground)] space-y-2">
            <p>
              Dismissed detections history is coming in a follow-up ship. In
              the meantime, open DevTools (Cmd+Opt+I → Console) to see the
              full pipeline log stream — every auto-fire, canonical
              correction, and detection event is prefixed with{" "}
              <code className="font-mono text-[10px]">[latency]</code> or{" "}
              <code className="font-mono text-[10px]">[song-autoprogression]</code>.
            </p>
          </div>
        </PopoverShell>
      )}
      {openKey === "settings" && (
        <PopoverShell title="Settings" onClose={() => setOpenKey(null)}>
          <SettingsPopoverBody timer={timer} messages={messages} />
        </PopoverShell>
      )}
      {openKey === "screens" && (
        <PopoverShell title="Screens" onClose={() => setOpenKey(null)}>
          <ScreensPanel />
        </PopoverShell>
      )}
    </div>
  );
}

function IconTrigger({
  k, openKey, setOpen, Icon, label, badge,
}: {
  k: PopoverKey;
  openKey: PopoverKey | null;
  setOpen: (k: PopoverKey | null) => void;
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  badge?: number;
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
            "relative flex-1 h-full flex items-center justify-center transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-inset",
            active
              ? "text-[var(--color-brand)] border-b-2 border-[var(--color-brand)]"
              : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-white/5",
          )}
        >
          <Icon className="w-4 h-4" />
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
  return (
    <div
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
      <div className="max-h-[400px] overflow-y-auto pf-transcript-scroll">
        {children}
      </div>
    </div>
  );
}

function SettingsPopoverBody({
  timer, messages,
}: {
  timer: TimerApi;
  messages: MessagesApi;
}) {
  const [subTab, setSubTab] = useState<"audio" | "messages" | "timers" | "themes" | "macros">("audio");
  const tabs: { k: typeof subTab; label: string }[] = [
    { k: "audio", label: "Audio" },
    { k: "messages", label: "Messages" },
    { k: "timers", label: "Timers" },
    { k: "themes", label: "Themes" },
    { k: "macros", label: "Macros" },
  ];
  return (
    <div className="flex flex-col">
      {/* 2026-07-25 fix — was `flex-1 min-w-0 px-2 uppercase tracking-wider`
          which visually collided in the narrow sidebar (5 labels squeezed
          under ~260px). Switched to natural-width tabs with whitespace-nowrap
          in an overflow-x-auto rail, and dropped the uppercase/wide-tracking
          so labels take ~half the width. Fits comfortably without scroll at
          most sidebar widths, scrolls cleanly when narrower. */}
      <div className="flex border-b border-[var(--color-border)] overflow-x-auto shrink-0 pf-transcript-scroll">
        {tabs.map((t) => (
          <button
            key={t.k}
            type="button"
            onClick={() => setSubTab(t.k)}
            className={cn(
              "h-8 px-3 text-[11px] font-medium whitespace-nowrap transition-colors",
              subTab === t.k
                ? "text-[var(--color-foreground)] border-b-2 border-[var(--color-brand)]"
                : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="p-2 text-[12px]">
        {subTab === "audio" && <AudioTab />}
        {subTab === "messages" && <MessagesTab api={messages} />}
        {subTab === "timers" && <TimersTab api={timer} />}
        {subTab === "themes" && <ThemesTab />}
        {subTab === "macros" && <MacrosTab />}
      </div>
    </div>
  );
}
