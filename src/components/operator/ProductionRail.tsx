"use client";
import { useEffect, useState } from "react";
import {
  ListMusic, BookOpen, Presentation, Image as ImageIcon, Timer, Type,
  Monitor, Radio, FileStack, Archive, Settings, ChevronRight, ChevronDown,
  ListOrdered, AlertTriangle, Sparkles, Check, PanelLeftClose, PanelLeftOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExpandedItem } from "@/lib/server/services";

/**
 * Cockpit left rail — 12 functional sections.
 *
 * Every button switches the active workspace/panel; no button is a no-op.
 * The rail can be collapsed to icons-only (state persists in localStorage
 * under `presentflow.rail.collapsed`).
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

export const SERVICE_SECTIONS = [
  "Pre-Service", "Worship", "Offering", "Sermon",
  "Ministry Time", "Announcements", "Post-Service",
] as const;

const COLLAPSE_KEY = "presentflow.rail.collapsed";
// "0" = expanded, "1" = icons only, "2" = fully hidden
type RailState = "expanded" | "icons" | "hidden";

const SECTIONS: { key: RailSection; label: string; icon: typeof ListMusic; group?: string }[] = [
  { key: "service", label: "Service Order", icon: ListOrdered },
  { key: "songs", label: "Songs", icon: ListMusic, group: "Library" },
  { key: "bible", label: "Bible", icon: BookOpen, group: "Library" },
  { key: "sermon", label: "Sermon Slides", icon: Presentation, group: "Library" },
  { key: "media", label: "Media", icon: ImageIcon, group: "Library" },
  { key: "timers", label: "Timers", icon: Timer, group: "Outputs" },
  { key: "lower_thirds", label: "Lower Thirds", icon: Type, group: "Outputs" },
  { key: "stage", label: "Stage Display", icon: Monitor, group: "Outputs" },
  { key: "livestream", label: "Livestream", icon: Radio, group: "Outputs" },
  { key: "imports", label: "Imports", icon: FileStack, group: "Workspace" },
  { key: "archive", label: "Archive", icon: Archive, group: "Workspace" },
  { key: "settings", label: "Settings", icon: Settings, group: "Workspace" },
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
  const [state, setState] = useState<RailState>("expanded");
  const collapsed = state === "icons";
  const hidden = state === "hidden";

  // Restore rail state from localStorage (post-mount to avoid hydration mismatch)
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COLLAPSE_KEY);
      if (raw === "1") setState("icons");
      else if (raw === "2") setState("hidden");
    } catch { /* noop */ }
  }, []);
  const persist = (s: RailState) => {
    setState(s);
    try {
      window.localStorage.setItem(
        COLLAPSE_KEY,
        s === "hidden" ? "2" : s === "icons" ? "1" : "0",
      );
    } catch { /* noop */ }
  };
  // Cycle: expanded → icons → hidden → expanded
  const toggleCollapsed = () => {
    persist(state === "expanded" ? "icons" : state === "icons" ? "hidden" : "expanded");
  };
  const reopen = () => persist("expanded");

  // Fully hidden — render only the floating reopen tab
  if (hidden) {
    return (
      <button
        onClick={reopen}
        title="Show sidebar"
        className="shrink-0 w-6 h-full border-r flex items-center justify-center text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-sidebar-item-hover)] hover:text-[color:var(--color-foreground)] transition-colors"
        style={{ borderColor: "var(--color-border)", background: "var(--color-panel)" }}
      >
        <PanelLeftOpen className="w-4 h-4" />
      </button>
    );
  }

  // Group sections for display
  const grouped: { label?: string; items: typeof SECTIONS }[] = [];
  for (const s of SECTIONS) {
    const groupLabel = s.group;
    const last = grouped[grouped.length - 1];
    if (last && last.label === groupLabel) last.items.push(s);
    else grouped.push({ label: groupLabel, items: [s] });
  }

  return (
    <aside
      className={cn(
        "shrink-0 border-r flex flex-col h-full min-h-0 transition-[width] duration-200 ease-out",
        collapsed ? "w-14" : "w-64",
      )}
      style={{ borderColor: "var(--color-border)", background: "var(--color-panel)" }}
    >
      <div className="px-2 py-2 border-b" style={{ borderColor: "var(--color-border)" }}>
        <nav className="space-y-2">
          {grouped.map((group, gi) => (
            <div key={gi}>
              {group.label && !collapsed && (
                <div className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--color-muted-foreground)]">
                  {group.label}
                </div>
              )}
              {group.label && collapsed && gi > 0 && (
                <div className="mx-2 my-1 h-px" style={{ background: "var(--color-border)" }} />
              )}
              <div className="space-y-0.5">
                {group.items.map(({ key, label, icon: Icon }) => {
                  const active = key === activeSection;
                  return (
                    <button
                      key={key}
                      onClick={() => onActiveChange(key)}
                      title={collapsed ? label : label}
                      className={cn(
                        "w-full flex items-center gap-2 h-9 rounded-md text-[11px] font-medium transition-colors relative",
                        collapsed ? "px-0 justify-center" : "px-2",
                        active
                          ? "text-[color:var(--color-foreground)]"
                          : "text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-sidebar-item-hover)] hover:text-[color:var(--color-foreground)]",
                      )}
                      style={active ? {
                        background: "color-mix(in oklab, var(--color-panel) 60%, transparent)",
                        boxShadow: "inset 2px 0 0 0 #7dd3c0",
                      } : undefined}
                    >
                      <Icon className="w-4 h-4 shrink-0" strokeWidth={active ? 2 : 1.75} />
                      {!collapsed && (
                        <span className="truncate flex-1 text-left" title={label}>{label}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </div>

      {/* Service Order expanded panel — only rendered when service is active and rail is expanded */}
      {activeSection === "service" && !collapsed && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div
            className="sticky top-0 px-3 py-1.5 flex items-center justify-between border-b backdrop-blur-sm"
            style={{ borderColor: "var(--color-border)", background: "color-mix(in oklab, var(--color-panel) 92%, transparent)" }}
          >
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--color-muted-foreground)]">
              Service Order · {items.length}
            </span>
          </div>
          <ServiceOrderList
            items={items}
            activeItemIdx={activeItemIdx}
            liveItemIdx={liveItemIdx}
            onJump={onJump}
          />
        </div>
      )}

      {activeSection !== "service" && !collapsed && (
        <RailSectionShell section={activeSection} />
      )}

      {/* Collapse toggle at bottom */}
      <button
        onClick={toggleCollapsed}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="shrink-0 h-9 border-t flex items-center justify-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-sidebar-item-hover)] hover:text-[color:var(--color-foreground)] transition-colors"
        style={{ borderColor: "var(--color-border)" }}
      >
        {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <><PanelLeftClose className="w-4 h-4" /> Collapse</>}
      </button>
    </aside>
  );
}

function ServiceOrderList({ items, activeItemIdx, liveItemIdx, onJump }: {
  items: ExpandedItem[]; activeItemIdx: number; liveItemIdx: number | null;
  onJump: (idx: number) => void;
}) {
  return (
    <ul className="px-2 py-2 space-y-1">
      {items.map((item, idx) => (
        <ServiceItem
          key={item.id}
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
      <button
        onClick={onJump}
        title={item.title}
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
        <div className="px-2 py-1.5 flex items-center gap-2">
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
          <span className="text-[11px] font-medium truncate flex-1 text-[color:var(--color-foreground)]">{item.title}</span>
          <span className="text-[10px] font-mono text-[color:var(--color-muted-foreground)] shrink-0">{item.slides.length}</span>
        </div>
        <div className="px-2 pb-1.5 flex items-center gap-1.5">
          <StatusChip status={status} />
          {missingMedia && (
            <span className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-[color:var(--color-warning)] border border-[color:var(--color-warning)]/50 rounded-sm px-1.5 py-0.5">
              <AlertTriangle className="w-2.5 h-2.5" /> Missing
            </span>
          )}
          {aiReady && (
            <span className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-[color:var(--color-brand)] border border-[color:var(--color-brand)]/40 rounded-sm px-1.5 py-0.5">
              <Sparkles className="w-2.5 h-2.5" /> AI
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

const SECTION_TITLES: Record<Exclude<RailSection, "service">, { title: string; body: string; href?: string; hrefLabel?: string }> = {
  songs:         { title: "Songs library", body: "Church-owned + public-domain songs.", href: "/library/songs", hrefLabel: "Open Songs library" },
  bible:         { title: "Bible browser", body: "Seven translations, verse-by-verse.", href: "/library/bible", hrefLabel: "Open Bible library" },
  sermon:        { title: "Sermon slides", body: "PPTX imports converted to slides.", href: "/library/imports", hrefLabel: "Open Imports" },
  media:         { title: "Media bin", body: "Images, videos, audio clips.", href: "/library/media", hrefLabel: "Open Media library" },
  timers:        { title: "Countdowns", body: "Countdown targets sent to Stage Display + Livestream. Open the Timers tab on the right sidebar." },
  lower_thirds:  { title: "Lower thirds", body: "Speaker / scripture overlays for stream. Manage from the Messages tab on the right sidebar." },
  stage:         { title: "Stage Display", body: "Confidence monitor for on-stage speakers.", href: "/stage", hrefLabel: "Open Stage output" },
  livestream:    { title: "Livestream", body: "Broadcast-safe output for OBS / Zoom.", href: "/livestream", hrefLabel: "Open Livestream output" },
  imports:       { title: "Imports", body: "PPTX, ProPresenter, CSV converters.", href: "/library/imports", hrefLabel: "Open Imports" },
  archive:       { title: "Sermon archive", body: "Past services + AI summaries.", href: "/archive", hrefLabel: "Open Archive" },
  settings:      { title: "Settings", body: "Church-wide preferences and integrations.", href: "/settings", hrefLabel: "Open Settings" },
};

function RailSectionShell({ section }: { section: Exclude<RailSection, "service"> }) {
  const meta = SECTION_TITLES[section];
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
      <div>
        <div className="text-sm font-semibold text-[color:var(--color-foreground)]">{meta.title}</div>
        <p className="text-[11px] text-[color:var(--color-muted-foreground)] mt-1 leading-relaxed">{meta.body}</p>
      </div>
      {meta.href && (
        <a
          href={meta.href}
          className="block w-full text-center h-8 leading-8 px-3 rounded-md border text-[11px] font-semibold text-[color:var(--color-foreground)] hover:bg-[color:var(--color-sidebar-item-hover)] transition-colors"
          style={{ borderColor: "var(--color-border)", background: "color-mix(in oklab, var(--color-panel) 60%, transparent)" }}
        >
          {meta.hrefLabel ?? "Open →"}
        </a>
      )}
    </div>
  );
}
