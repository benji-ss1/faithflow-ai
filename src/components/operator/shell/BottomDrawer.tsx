"use client";
import { useEffect, useState } from "react";
import { ChevronUp, ChevronDown, Image as ImageIcon, ListMusic, Layers, Sun, Timer, Upload, History, Grid3x3, List, Filter as FilterIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import type { OperatorShellCtx } from "./types";

type DrawerTab = "media" | "playlists" | "backgrounds" | "logos" | "timers" | "recent" | "imports";
const TABS: { key: DrawerTab; label: string; icon: typeof ImageIcon }[] = [
  { key: "media",       label: "Media",       icon: ImageIcon },
  { key: "playlists",   label: "Playlists",   icon: ListMusic },
  { key: "backgrounds", label: "Backgrounds", icon: Layers },
  { key: "logos",       label: "Logos",       icon: Sun },
  { key: "timers",      label: "Timers",      icon: Timer },
  { key: "recent",      label: "Recent",      icon: History },
  { key: "imports",     label: "Imports",     icon: Upload },
];

const KEY = "faithflow.drawer.expanded";

export function BottomDrawer({ ctx }: { ctx: OperatorShellCtx }) {
  // Hydrate from localStorage post-mount so SSR + first client render agree.
  const [expanded, setExpanded] = useState<boolean>(true);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try { const raw = window.localStorage.getItem(KEY); if (raw !== null) setExpanded(raw === "1"); } catch { /* noop */ }
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try { window.localStorage.setItem(KEY, expanded ? "1" : "0"); } catch { /* noop */ }
  }, [expanded, hydrated]);
  const [tab, setTab] = useState<DrawerTab>("media");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [filter, setFilter] = useState("");

  const item = ctx.plan.items[ctx.previewItemIdx];

  return (
    <div className="shrink-0 border-t flex flex-col" style={{ borderColor: "#2a3232", background: "#1e2525" }}>
      {/* Tab strip + toggle */}
      <div className="h-8 shrink-0 flex items-center gap-0.5 px-1 border-b overflow-x-auto" style={{ borderColor: "#2a3232" }}>
        {TABS.map(({ key, label, icon: Icon }) => {
          const on = tab === key;
          return (
            <button key={key} onClick={() => { setTab(key); if (!expanded) setExpanded(true); }}
              title={label}
              className={cn(
                "h-7 px-2 rounded-md text-[10px] font-semibold uppercase tracking-wider inline-flex items-center gap-1 whitespace-nowrap",
                on ? "bg-teal-500/15 text-teal-200" : "text-zinc-400 hover:text-zinc-100 hover:bg-white/5",
              )}>
              <Icon className="w-3 h-3" />
              {label}
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-1">
          {expanded && (
            <>
              <div className="relative">
                <FilterIcon className="w-3 h-3 absolute left-1.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input value={filter} onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter..."
                  className="h-6 pl-6 pr-2 rounded-md text-[10px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none border w-32"
                  style={{ background: "#1a2020", borderColor: "#2a3232" }} />
              </div>
              <ViewToggle current={view} onChange={setView} />
            </>
          )}
          <button onClick={() => setExpanded((v) => !v)}
            title={expanded ? "Collapse drawer" : "Expand drawer"}
            className="h-6 w-6 inline-flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/5">
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="h-40 overflow-y-auto p-2">
          {tab === "media" && item && (
            view === "grid" ? (
              <div className="flex gap-2 overflow-x-auto">
                {item.slides
                  .filter((s) => !filter || (s.kind === "text" && s.text.toLowerCase().includes(filter.toLowerCase())))
                  .map((s, i) => {
                    const active = ctx.previewSlideIdx === i;
                    return (
                      <button key={i} onClick={() => ctx.onJumpSlide(ctx.previewItemIdx, i)}
                        className={cn(
                          "shrink-0 w-36 aspect-video rounded-sm overflow-hidden border-2 relative",
                          active ? "border-teal-400" : "border-[#2a3232] hover:border-zinc-500",
                        )}>
                        <div className="absolute inset-0 pointer-events-none"><SlideRenderer slide={s} /></div>
                        <span className="absolute top-1 left-1 text-[9px] font-mono text-white bg-black/70 px-1 rounded-sm">{i + 1}</span>
                      </button>
                    );
                  })}
              </div>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {item.slides.map((s, i) => (
                  <li key={i}>
                    <button onClick={() => ctx.onJumpSlide(ctx.previewItemIdx, i)}
                      className={cn(
                        "w-full text-left h-7 px-2 rounded-md text-[11px] truncate",
                        i === ctx.previewSlideIdx ? "bg-teal-500/10 text-teal-100" : "text-zinc-300 hover:bg-white/5",
                      )}>
                      <span className="text-zinc-500 font-mono mr-2">{i + 1}</span>
                      {s.kind === "text" ? s.text.split("\n")[0] : `[${s.kind}]`}
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}
          {tab === "playlists"   && <Stub title="Playlists"   hint="Saved playlists — coming next: quick-swap between plans without losing autopilot state." />}
          {tab === "backgrounds" && <Stub title="Backgrounds" hint="Motion + still full-screen backgrounds for slides. Upload from Media library." />}
          {tab === "logos"       && <Stub title="Logos"       hint="Church logos and event marks. Click to broadcast as overlay." />}
          {tab === "timers"      && <Stub title="Timers"      hint="Countdowns broadcast to /stage and /livestream." />}
          {tab === "recent"      && <Stub title="Recent"      hint="Everything you've imported or edited this session." />}
          {tab === "imports"     && <Stub title="Imports"     hint="Songs, sermon slides, ProPresenter files, PPTX." />}
        </div>
      )}
    </div>
  );
}

function ViewToggle({ current, onChange }: { current: "grid" | "list"; onChange: (v: "grid" | "list") => void }) {
  return (
    <div className="inline-flex items-center rounded-md border" style={{ borderColor: "#2a3232" }}>
      <button onClick={() => onChange("grid")} title="Grid"
        className={cn("h-6 w-6 inline-flex items-center justify-center border-r", current === "grid" ? "bg-teal-500/15 text-teal-200" : "text-zinc-400 hover:text-zinc-100")}
        style={{ borderColor: "#2a3232" }}>
        <Grid3x3 className="w-3 h-3" />
      </button>
      <button onClick={() => onChange("list")} title="List"
        className={cn("h-6 w-6 inline-flex items-center justify-center", current === "list" ? "bg-teal-500/15 text-teal-200" : "text-zinc-400 hover:text-zinc-100")}>
        <List className="w-3 h-3" />
      </button>
    </div>
  );
}

function Stub({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="p-2">
      <div className="text-[11px] font-semibold text-zinc-200">{title}</div>
      <p className="text-[10px] text-zinc-500 italic mt-1 leading-relaxed">{hint}</p>
    </div>
  );
}
