"use client";
import Link from "next/link";
import { useState } from "react";
import {
  ArrowLeft, Search, Type, Palette, ListMusic, Edit3, Shuffle, BookOpen,
  Image as ImageIcon, MoreHorizontal, Mic, MicOff, Radio, Monitor, Users,
  Wifi, Zap, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { OperatorShellCtx, InspectorTab } from "./types";
import type { AutopilotMode } from "../OperatorConsole";
import { EndServiceButton } from "../EndServiceButton";

type ToolKey = "search" | "text" | "theme" | "show" | "edit" | "reflow" | "bible" | "media" | "more";
const TOOLS: { key: ToolKey; label: string; icon: typeof Search; hint: string }[] = [
  { key: "search", label: "Search",  icon: Search,          hint: "Search library and playlist" },
  { key: "text",   label: "Text",    icon: Type,            hint: "Insert / edit text slide" },
  { key: "theme",  label: "Theme",   icon: Palette,         hint: "Global slide theme" },
  { key: "show",   label: "Show",    icon: ListMusic,       hint: "Show / playlist view" },
  { key: "edit",   label: "Edit",    icon: Edit3,           hint: "Edit current item" },
  { key: "reflow", label: "Reflow",  icon: Shuffle,         hint: "Auto-reflow slides" },
  { key: "bible",  label: "Bible",   icon: BookOpen,        hint: "Bible lookup" },
  { key: "media",  label: "Media",   icon: ImageIcon,       hint: "Media library" },
  { key: "more",   label: "More",    icon: MoreHorizontal,  hint: "End service / settings" },
];

export function TopToolbar({
  ctx, onSwitchInspector, planTitle,
}: {
  ctx: OperatorShellCtx;
  onSwitchInspector: (t: InspectorTab) => void;
  planTitle: string;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  function handleTool(k: ToolKey) {
    switch (k) {
      case "search": setSearchOpen(true); break;
      case "text":   onSwitchInspector("layers"); break;
      case "theme":  onSwitchInspector("output"); break;
      case "show":   onSwitchInspector("output"); break;
      case "edit":   onSwitchInspector("layers"); break;
      case "reflow": onSwitchInspector("output"); break;
      case "bible":  onSwitchInspector("ai"); break;
      case "media":  onSwitchInspector("props"); break;
      case "more":   setMoreOpen((v) => !v); break;
    }
  }

  const listening = ctx.audio.listening;

  return (
    <>
      <div className="h-11 shrink-0 border-b flex items-center gap-1 px-2 relative"
        style={{ borderColor: "#2a3232", background: "#1a2020" }}>
        <Link href={`/services/${ctx.planId}`} title="Back to plan"
          className="h-8 w-8 rounded-md inline-flex items-center justify-center text-zinc-400 hover:bg-white/5 hover:text-zinc-100">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="pr-2 mr-1 border-r flex flex-col leading-tight" style={{ borderColor: "#2a3232" }}>
          <span className="text-[9px] uppercase tracking-[0.16em] text-zinc-500">Operator</span>
          <span className="text-[11px] font-semibold text-zinc-200 truncate max-w-[180px]" title={planTitle}>{planTitle}</span>
        </div>

        {/* Left tool group */}
        <div className="flex items-center gap-0.5">
          {TOOLS.map(({ key, label, icon: Icon, hint }) => (
            <button key={key} title={hint} onClick={() => handleTool(key)}
              className="h-8 px-2 rounded-md inline-flex items-center gap-1.5 text-zinc-400 hover:bg-white/5 hover:text-zinc-100 text-[11px] font-semibold">
              <Icon className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">{label}</span>
            </button>
          ))}
        </div>

        {/* Right cluster */}
        <div className="ml-auto flex items-center gap-1.5">
          <AutopilotPicker mode={ctx.autopilotMode} onChange={ctx.onAutopilotModeChange} />

          <button title="Default output canvas"
            className="h-7 px-2 rounded-md border text-[10px] font-mono text-zinc-300 hover:bg-white/5"
            style={{ borderColor: "#2a3232", background: "#1e2525" }}>
            1920×1080 · 16:9
          </button>

          <StatusPill live={ctx.liveSlide.kind !== "empty"} />

          <div className="flex items-center gap-1 px-2 h-7 rounded-md border" style={{ borderColor: "#2a3232", background: "#1e2525" }}>
            <MiniDot label="Audience" ok={true} icon={<Users className="w-3 h-3" />} />
            <MiniDot label="Stage" ok={true} icon={<Monitor className="w-3 h-3" />} />
            <MiniDot label="Livestream" ok={true} icon={<Wifi className="w-3 h-3" />} />
          </div>

          <button title={listening ? "AI listening — click to stop" : "AI not listening"}
            onClick={ctx.onListenToggle}
            className={cn(
              "h-7 inline-flex items-center gap-1.5 px-2 rounded-md text-[10px] font-bold uppercase tracking-wider border",
              listening
                ? "bg-emerald-500/10 border-emerald-500/50 text-emerald-300"
                : "bg-transparent border-[#2a3232] text-zinc-400 hover:text-zinc-200",
            )}>
            {listening ? <Mic className="w-3 h-3" /> : <MicOff className="w-3 h-3" />}
            AI {listening ? "On" : "Off"}
          </button>

          <button onClick={ctx.onOpenProjector} title="Open live projector window"
            className="h-7 inline-flex items-center gap-1.5 px-2 rounded-md text-[10px] font-bold uppercase tracking-wider border border-teal-500/50 text-teal-300 bg-teal-500/10 hover:bg-teal-500/20">
            <Monitor className="w-3 h-3" /> Open projector
          </button>
        </div>

        {moreOpen && (
          <div className="absolute right-2 top-11 z-40 w-72 rounded-md border shadow-lg p-2 flex flex-col gap-1.5"
            style={{ borderColor: "#2a3232", background: "#232b2b" }}>
            <div className="text-[9px] uppercase tracking-[0.16em] text-zinc-500 px-1 py-1">More</div>
            <button onClick={() => { ctx.onOpenStage(); setMoreOpen(false); }}
              className="h-8 px-2 rounded-md text-left text-[11px] text-zinc-200 hover:bg-white/5 inline-flex items-center gap-2">
              <Monitor className="w-3.5 h-3.5" /> Open Stage Display
            </button>
            <button onClick={() => { ctx.onOpenStream(); setMoreOpen(false); }}
              className="h-8 px-2 rounded-md text-left text-[11px] text-zinc-200 hover:bg-white/5 inline-flex items-center gap-2">
              <Radio className="w-3.5 h-3.5" /> Open Livestream Preview
            </button>
            <div className="h-px my-1" style={{ background: "#2a3232" }} />
            <div onClick={() => setMoreOpen(false)}>
              <EndServiceButton planId={ctx.planId} hasTranscript={ctx.endServiceHasTranscript} />
            </div>
          </div>
        )}

        {searchOpen && (
          <div className="absolute left-1/2 -translate-x-1/2 top-11 z-40 w-96 rounded-md border shadow-lg p-3"
            style={{ borderColor: "#2a3232", background: "#232b2b" }}>
            <div className="text-[9px] uppercase tracking-[0.16em] text-zinc-500 mb-2">Quick search</div>
            <input autoFocus placeholder="Songs, scripture, playlist items..."
              onKeyDown={(e) => { if (e.key === "Escape") setSearchOpen(false); }}
              className="w-full h-8 px-2 rounded-md text-[12px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none border"
              style={{ background: "#1a2020", borderColor: "#2a3232" }} />
            <p className="text-[10px] text-zinc-500 mt-2 italic">
              Coming next: fuzzy match across library, live filtering, keyboard nav.
            </p>
          </div>
        )}
      </div>
    </>
  );
}

function StatusPill({ live }: { live: boolean }) {
  return (
    <span className={cn(
      "h-7 inline-flex items-center gap-1.5 px-2 rounded-md text-[10px] font-bold uppercase tracking-[0.14em] border",
      live
        ? "bg-red-500/15 border-red-500/60 text-red-300 animate-pulse"
        : "bg-zinc-800/60 border-[#2a3232] text-zinc-400",
    )}>
      <span className={cn("w-1.5 h-1.5 rounded-full", live ? "bg-red-400" : "bg-zinc-500")} />
      {live ? "Live" : "Off-Air"}
    </span>
  );
}

function MiniDot({ label, ok, icon }: { label: string; ok: boolean; icon: React.ReactNode }) {
  return (
    <span title={`${label}: ${ok ? "connected" : "offline"}`}
      className="inline-flex items-center gap-1 text-zinc-400">
      {icon}
      <span className={cn("w-1.5 h-1.5 rounded-full", ok ? "bg-emerald-400" : "bg-zinc-600")} />
    </span>
  );
}

function AutopilotPicker({ mode, onChange }: { mode: AutopilotMode; onChange: (m: AutopilotMode) => void }) {
  const items: { key: AutopilotMode; label: string; hint: string }[] = [
    { key: "manual",     label: "MAN", hint: "Manual — no AI actions" },
    { key: "suggestion", label: "SUG", hint: "Suggestion — every action needs approval" },
    { key: "armed",      label: "ARM", hint: "Armed — autopilot primed, next step: Active" },
    { key: "active",     label: "ACT", hint: "Active — high-confidence scripture auto-stages" },
  ];
  return (
    <div className="inline-flex items-center rounded-md border overflow-hidden text-[10px] font-bold uppercase tracking-wider h-7"
      style={{ borderColor: "#2a3232" }}>
      {items.map((it) => {
        const on = it.key === mode;
        const danger = it.key === "active";
        const warn = it.key === "armed";
        return (
          <button key={it.key} title={it.hint} onClick={() => onChange(it.key)}
            className={cn(
              "px-2 h-full border-r last:border-r-0 transition-colors",
              !on && "text-zinc-400 hover:bg-white/5 hover:text-zinc-100",
              on && danger && "bg-red-500/20 text-red-300",
              on && warn && "bg-amber-500/20 text-amber-300",
              on && !danger && !warn && "bg-teal-500/20 text-teal-200",
            )}
            style={{ borderColor: "#2a3232" }}>
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
