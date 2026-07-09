"use client";
import { useState } from "react";
import { ListMusic, BookOpen, Presentation, Image as ImageIcon, Timer, Type, Monitor, Radio, FileStack, Archive, Settings, ChevronRight, ChevronDown, ListOrdered, AlertTriangle, Sparkles, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExpandedItem } from "@/lib/server/services";

/**
 * Cockpit left rail: 12 grouped sections mirroring the way a production
 * operator thinks about a service. Only "Service Order" is data-driven
 * right now — the rest are structural stubs sized so the cockpit looks
 * intentional even before those data models exist.
 *
 * Sections are grouped and collapsible. The active section drives what
 * the main workspace shows (via `activeSection` + `onActiveChange`).
 */

export type RailSection =
  | "service"
  | "songs"
  | "bible"
  | "sermon"
  | "media"
  | "timers"
  | "lower_thirds"
  | "stage"
  | "livestream"
  | "imports"
  | "archive"
  | "settings";

type ItemStatus = "idle" | "live" | "preview" | "missing_media" | "ai_ready";

// Section labels for the Service Order — categorises items visually
// even when the underlying plan is just a flat ordered list.
export const SERVICE_SECTIONS = [
  "Pre-Service", "Worship", "Offering", "Sermon",
  "Ministry Time", "Announcements", "Post-Service",
] as const;

const GROUPS: { label?: string; items: { key: RailSection; label: string; icon: typeof ListMusic; badge?: number }[] }[] = [
  {
    items: [
      { key: "service", label: "Service Order", icon: ListOrdered },
    ],
  },
  {
    label: "Library",
    items: [
      { key: "songs", label: "Songs", icon: ListMusic },
      { key: "bible", label: "Bible", icon: BookOpen },
      { key: "sermon", label: "Sermon Slides", icon: Presentation },
      { key: "media", label: "Media", icon: ImageIcon },
    ],
  },
  {
    label: "Outputs",
    items: [
      { key: "timers", label: "Timers", icon: Timer },
      { key: "lower_thirds", label: "Lower Thirds", icon: Type },
      { key: "stage", label: "Stage Display", icon: Monitor },
      { key: "livestream", label: "Livestream", icon: Radio },
    ],
  },
  {
    label: "Workspace",
    items: [
      { key: "imports", label: "Imports", icon: FileStack },
      { key: "archive", label: "Archive", icon: Archive },
      { key: "settings", label: "Settings", icon: Settings },
    ],
  },
];

export function ProductionRail({
  items,
  activeItemIdx,
  liveItemIdx,
  activeSection,
  onActiveChange,
  onJump,
}: {
  items: ExpandedItem[];
  activeItemIdx: number;
  liveItemIdx: number | null;
  activeSection: RailSection;
  onActiveChange: (s: RailSection) => void;
  onJump: (itemIdx: number) => void;
}) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ Library: true, Outputs: true, Workspace: true });
  const [showServiceOrder, setShowServiceOrder] = useState(true);

  return (
    <aside className="w-72 shrink-0 border-r flex flex-col h-full min-h-0"
      style={{ borderColor: "var(--color-border)", background: "var(--color-panel)" }}>
      {/* Section list */}
      <div className="px-3 py-3 border-b" style={{ borderColor: "var(--color-border)" }}>
        <nav className="space-y-3">
          {GROUPS.map((group, gi) => (
            <div key={gi}>
              {group.label && (
                <button
                  onClick={() => setOpenGroups((s) => ({ ...s, [group.label!]: !s[group.label!] }))}
                  className="w-full flex items-center gap-1 px-1 mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--color-muted-foreground)]"
                >
                  {openGroups[group.label] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  {group.label}
                </button>
              )}
              {(!group.label || openGroups[group.label]) && (
                <div className="space-y-0.5">
                  {group.items.map(({ key, label, icon: Icon }) => {
                    const active = key === activeSection;
                    return (
                      <button
                        key={key}
                        onClick={() => onActiveChange(key)}
                        className={cn(
                          "w-full flex items-center gap-2 px-2 h-8 rounded-md text-sm transition-colors",
                          active
                            ? "bg-[color:var(--color-elevated)] text-[color:var(--color-foreground)] font-medium"
                            : "text-[color:var(--color-sidebar-fg)] hover:bg-[color:var(--color-sidebar-item-hover)]",
                        )}
                      >
                        <Icon className="w-4 h-4 shrink-0" strokeWidth={active ? 2 : 1.75} />
                        <span className="truncate flex-1 text-left">{label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </nav>
      </div>

      {/* Service Order expanded panel — the only data-driven section for now */}
      {activeSection === "service" && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="sticky top-0 px-3 py-2 flex items-center justify-between border-b backdrop-blur-sm"
            style={{ borderColor: "var(--color-border)", background: "color-mix(in oklab, var(--color-panel) 92%, transparent)" }}>
            <button onClick={() => setShowServiceOrder((v) => !v)}
              className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--color-muted-foreground)]">
              {showServiceOrder ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              Service Order · {items.length} items
            </button>
          </div>
          {showServiceOrder && (
            <ServiceOrderList
              items={items}
              activeItemIdx={activeItemIdx}
              liveItemIdx={liveItemIdx}
              onJump={onJump}
            />
          )}
        </div>
      )}

      {/* Non-service sections show a scaffolded empty state */}
      {activeSection !== "service" && (
        <RailSectionShell section={activeSection} />
      )}
    </aside>
  );
}

/** Groups items by heuristic (their `title` matching a service-section
 * keyword). If no items match a section, that header collapses out. */
function ServiceOrderList({ items, activeItemIdx, liveItemIdx, onJump }: {
  items: ExpandedItem[]; activeItemIdx: number; liveItemIdx: number | null;
  onJump: (idx: number) => void;
}) {
  return (
    <ul className="px-2 py-2 space-y-1">
      {/* Simple flat render for MVP — service-section headers become
          separators when the operator explicitly adds them (Phase 2+
          data model). Today: flat list with title + status. */}
      {items.map((item, idx) => (
        <ServiceItem key={item.id}
          item={item} idx={idx}
          isActive={idx === activeItemIdx}
          isLive={idx === liveItemIdx}
          onJump={() => onJump(idx)}
        />
      ))}
      {items.length === 0 && (
        <li className="px-2 py-8 text-center text-xs text-[color:var(--color-muted-foreground)]">
          No items in the plan yet.
        </li>
      )}
    </ul>
  );
}

function ServiceItem({ item, idx, isActive, isLive, onJump }: {
  item: ExpandedItem; idx: number; isActive: boolean; isLive: boolean; onJump: () => void;
}) {
  const status: ItemStatus = isLive ? "live" : isActive ? "preview" : "idle";
  const aiReady = item.type === "scripture" || item.type === "song";
  const missingMedia = item.type === "media" && item.slides.length === 0;

  return (
    <li>
      <button onClick={onJump}
        className={cn(
          "w-full text-left rounded-md border transition-colors overflow-hidden",
          isLive ? "border-[color:var(--color-destructive)]"
            : isActive ? "border-[color:var(--color-brand)]"
            : "border-[color:var(--color-border)] hover:border-[color:var(--color-muted-foreground)]",
        )}
        style={{
          background: isActive || isLive
            ? "color-mix(in oklab, var(--color-brand) 6%, var(--color-raised-shell))"
            : "var(--color-raised-shell)",
        }}
      >
        <div className="px-2.5 py-2 flex items-center gap-2">
          <span className="text-[10px] font-mono opacity-40 w-4 shrink-0">{String(idx + 1).padStart(2, "0")}</span>
          <span className={cn(
            "eyebrow shrink-0 text-[9px]",
            item.type === "song" && "text-[color:var(--color-brand)]",
            item.type === "scripture" && "text-[color:var(--color-success)]",
            item.type === "sermon" && "text-[color:var(--color-warning)]",
            item.type === "media" && "text-[color:var(--color-muted-foreground)]",
          )}>
            {item.type}
          </span>
          <span className="text-sm font-medium truncate flex-1 text-[color:var(--color-foreground)]">{item.title}</span>
          <span className="text-[10px] font-mono text-[color:var(--color-muted-foreground)] shrink-0">{item.slides.length}</span>
        </div>
        <div className="px-2.5 pb-2 flex items-center gap-1.5">
          <StatusChip status={status} />
          {missingMedia && (
            <span className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-[color:var(--color-warning)] border border-[color:var(--color-warning)]/50 rounded-sm px-1.5 py-0.5">
              <AlertTriangle className="w-2.5 h-2.5" /> Media missing
            </span>
          )}
          {aiReady && (
            <span className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-[color:var(--color-brand)] border border-[color:var(--color-brand)]/40 rounded-sm px-1.5 py-0.5">
              <Sparkles className="w-2.5 h-2.5" /> AI ready
            </span>
          )}
        </div>
      </button>
    </li>
  );
}

function StatusChip({ status }: { status: ItemStatus }) {
  if (status === "live") return (
    <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-[color:var(--color-destructive)]">
      <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--color-destructive)] animate-pulse" /> Live
    </span>
  );
  if (status === "preview") return (
    <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-[color:var(--color-brand)]">
      <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--color-brand)]" /> Staged
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-[color:var(--color-muted-foreground)]">
      <Check className="w-2.5 h-2.5" /> Ready
    </span>
  );
}

const SECTION_TITLES: Record<Exclude<RailSection, "service">, { title: string; body: string }> = {
  songs:         { title: "Songs library", body: "Full library at /library/songs. This rail-embedded browser lands in Phase 2." },
  bible:         { title: "Bible browser", body: "Seven translations. Full browser at /library/bible; command palette does inline search." },
  sermon:        { title: "Sermon slides", body: "PPTX imports live at /library/imports. Deck-mode editor lands next phase." },
  media:         { title: "Media bin", body: "Full library at /library/media. Quick-drop into the bottom tray coming soon." },
  timers:        { title: "Countdown timers", body: "Countdown targets, timer overlays. Wired to Stage Display output in Phase 2." },
  lower_thirds:  { title: "Lower thirds", body: "Speaker + scripture overlays for the livestream output." },
  stage:         { title: "Stage Display", body: "Confidence monitor with current + next slide, clock, countdown, notes. Route: /stage." },
  livestream:    { title: "Livestream", body: "Broadcast-safe output surface. Route: /livestream." },
  imports:       { title: "Imports", body: "PPTX + ProPresenter / OpenSong / CSV. Full manager at /library/imports." },
  archive:       { title: "Sermon archive", body: "Past services + AI summaries. Full page at /archive." },
  settings:      { title: "Church settings", body: "Full settings page at /settings — AI, Bible defaults, Autopilot." },
};

function RailSectionShell({ section }: { section: Exclude<RailSection, "service"> }) {
  const meta = SECTION_TITLES[section];
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
      <div>
        <div className="text-sm font-semibold text-[color:var(--color-foreground)]">{meta.title}</div>
        <p className="text-xs text-[color:var(--color-muted-foreground)] mt-1 leading-relaxed">{meta.body}</p>
      </div>
      {/* Skeleton rows so the rail doesn't look empty */}
      <ul className="space-y-1.5 pt-2 border-t" style={{ borderColor: "var(--color-border)" }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <li key={i} className="rounded-md p-2.5" style={{ background: "var(--color-raised-shell)" }}>
            <div className="h-2.5 w-3/5 rounded-sm mb-1.5" style={{ background: "var(--color-elevated)" }} />
            <div className="h-2 w-2/5 rounded-sm" style={{ background: "var(--color-elevated)", opacity: 0.6 }} />
          </li>
        ))}
      </ul>
    </div>
  );
}
