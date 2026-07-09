"use client";
import { useState } from "react";
import { ChevronDown, ChevronRight, Music, BookOpen, Image as ImageIcon, Presentation, ListMusic, Upload, Filter as FilterIcon, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OperatorShellCtx } from "./types";

type LibKey = "songs" | "bible" | "media" | "sermon" | "playlists" | "imports";
const LIB: { key: LibKey; label: string; icon: typeof Music }[] = [
  { key: "songs",     label: "Songs",         icon: Music },
  { key: "bible",     label: "Bible",         icon: BookOpen },
  { key: "media",     label: "Media",         icon: ImageIcon },
  { key: "sermon",    label: "Sermon Slides", icon: Presentation },
  { key: "playlists", label: "Playlists",     icon: ListMusic },
  { key: "imports",   label: "Imports",       icon: Upload },
];

export function LeftColumn({ ctx }: { ctx: OperatorShellCtx }) {
  const [libOpen, setLibOpen] = useState(true);
  const [playOpen, setPlayOpen] = useState(true);
  const [filterOpen, setFilterOpen] = useState(true);
  const [activeLib, setActiveLib] = useState<LibKey>("playlists");
  const [filter, setFilter] = useState("");

  return (
    <aside className="w-56 shrink-0 flex flex-col border-r min-h-0"
      style={{ borderColor: "#2a3232", background: "#1e2525" }}>
      <Panel title="Library" open={libOpen} onToggle={() => setLibOpen((v) => !v)}>
        <ul className="flex flex-col">
          {LIB.map(({ key, label, icon: Icon }) => {
            const active = activeLib === key;
            return (
              <li key={key}>
                <button onClick={() => setActiveLib(key)}
                  title={`Open ${label}`}
                  className={cn(
                    "w-full flex items-center gap-2 h-7 px-2 rounded-md text-[11px] text-left",
                    active ? "bg-teal-500/10 text-teal-200" : "text-zinc-300 hover:bg-white/5",
                  )}>
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel title={`Playlist · ${ctx.plan.items.length}`} open={playOpen} onToggle={() => setPlayOpen((v) => !v)}>
        <div className="max-h-[45vh] overflow-y-auto pr-0.5">
          <ul className="flex flex-col">
            {ctx.plan.items
              .map((it, idx) => ({ it, idx }))
              .filter(({ it }) => !filter || it.title.toLowerCase().includes(filter.toLowerCase()))
              .map(({ it, idx }) => {
                const active = ctx.previewItemIdx === idx;
                const live = ctx.liveItemIdx === idx;
                return (
                  <li key={idx}>
                    <button onClick={() => ctx.onSetPreviewItem(idx)}
                      title={it.title}
                      className={cn(
                        "w-full h-8 flex items-center gap-2 px-2 rounded-md text-left",
                        active ? "bg-teal-500/10" : "hover:bg-white/5",
                      )}>
                      <span className="text-[9px] font-mono uppercase text-zinc-500 w-7 shrink-0">{it.type.slice(0, 4)}</span>
                      <span className={cn("text-[12px] font-medium truncate flex-1", active ? "text-teal-100" : "text-zinc-200")}>
                        {it.title}
                      </span>
                      <span className="text-[10px] font-mono text-zinc-500 shrink-0">{it.slides.length}</span>
                      <PipDot active={active} live={live} />
                    </button>
                  </li>
                );
              })}
          </ul>
        </div>
      </Panel>

      <Panel title="Filter" open={filterOpen} onToggle={() => setFilterOpen((v) => !v)}>
        <div className="relative">
          <FilterIcon className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter playlist..."
            className="w-full h-7 pl-7 pr-2 rounded-md text-[11px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none border"
            style={{ background: "#1a2020", borderColor: "#2a3232" }} />
        </div>
      </Panel>
    </aside>
  );
}

function Panel({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <section className="border-b flex flex-col shrink-0" style={{ borderColor: "#2a3232" }}>
      <button onClick={onToggle}
        className="h-7 px-2 flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] text-zinc-400 hover:text-zinc-100">
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <span className="truncate">{title}</span>
      </button>
      {open && <div className="px-1.5 pb-2">{children}</div>}
    </section>
  );
}

function PipDot({ active, live }: { active: boolean; live: boolean }) {
  if (live) return <Circle className="w-2 h-2 text-red-400 fill-red-400 shrink-0" />;
  if (active) return <Circle className="w-2 h-2 text-teal-300 fill-teal-300 shrink-0" />;
  return <Circle className="w-2 h-2 text-zinc-700 shrink-0" />;
}
