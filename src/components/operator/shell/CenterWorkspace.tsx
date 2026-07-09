"use client";
import { useState } from "react";
import { Grid3x3, List, Type as TypeIcon, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import type { OperatorShellCtx } from "./types";

type ViewMode = "grid" | "list" | "text";

export function CenterWorkspace({ ctx }: { ctx: OperatorShellCtx }) {
  const [view, setView] = useState<ViewMode>("grid");
  const item = ctx.plan.items[ctx.previewItemIdx];

  if (!item) {
    return (
      <div className="flex-1 min-w-0 min-h-0 flex items-center justify-center"
        style={{ background: "#171c1c" }}>
        <div className="text-center max-w-sm p-6 rounded-lg border"
          style={{ borderColor: "#2a3232", background: "#1e2525" }}>
          <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500 mb-2">Workspace</div>
          <div className="text-sm font-semibold text-zinc-200 mb-1">Select an item or create new content</div>
          <p className="text-[11px] text-zinc-500 leading-relaxed">
            Pick a playlist item on the left, or use the top toolbar to open a library.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col" style={{ background: "#171c1c" }}>
      {/* Title bar */}
      <div className="h-10 shrink-0 flex items-center gap-2 px-3 border-b" style={{ borderColor: "#2a3232" }}>
        <span className="text-[9px] font-mono uppercase tracking-[0.16em] text-zinc-500">{item.type}</span>
        <ChevronRight className="w-3 h-3 text-zinc-600" />
        <span className="text-[12px] font-medium text-zinc-200 truncate" title={item.title}>{item.title}</span>
        <span className="text-[10px] font-mono text-zinc-500 ml-2">
          Slide {ctx.previewSlideIdx + 1} / {item.slides.length}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <ViewToggle current={view} onChange={setView} />
        </div>
      </div>

      {/* Slide area */}
      <div className="flex-1 min-h-0 min-w-0 overflow-y-auto p-4">
        {view === "grid" && (
          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
            {item.slides.map((s, i) => {
              const isActive = i === ctx.previewSlideIdx;
              return (
                <button key={i}
                  onClick={() => ctx.onJumpSlide(ctx.previewItemIdx, i)}
                  onDoubleClick={() => { ctx.onJumpSlide(ctx.previewItemIdx, i); setTimeout(() => ctx.onSendToLive(), 0); }}
                  title={`Slide ${i + 1} — click to stage, double-click to Live`}
                  className={cn(
                    "relative aspect-video rounded-md overflow-hidden border-2 transition-all",
                    isActive
                      ? "border-teal-400 ring-2 ring-teal-500/30"
                      : "border-[#2a3232] hover:border-zinc-500",
                  )}>
                  <div className="absolute inset-0 pointer-events-none">
                    <SlideRenderer slide={s} />
                  </div>
                  <span className="absolute top-1 left-1 text-[9px] font-mono text-white bg-black/70 px-1 rounded-sm">
                    {i + 1}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {view === "list" && (
          <ul className="flex flex-col gap-1">
            {item.slides.map((s, i) => {
              const isActive = i === ctx.previewSlideIdx;
              const text = s.kind === "text" ? s.text : `[${s.kind}]`;
              return (
                <li key={i}>
                  <button onClick={() => ctx.onJumpSlide(ctx.previewItemIdx, i)}
                    onDoubleClick={() => { ctx.onJumpSlide(ctx.previewItemIdx, i); setTimeout(() => ctx.onSendToLive(), 0); }}
                    className={cn(
                      "w-full text-left h-9 px-2 flex items-center gap-2 rounded-md",
                      isActive ? "bg-teal-500/10 text-teal-100" : "text-zinc-300 hover:bg-white/5",
                    )}>
                    <span className="text-[10px] font-mono text-zinc-500 w-6 shrink-0">{i + 1}</span>
                    <span className="text-[12px] truncate flex-1">{text.split("\n")[0]}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {view === "text" && (
          <div className="prose prose-invert max-w-none text-zinc-200 text-sm whitespace-pre-wrap">
            {item.slides.map((s, i) => (
              <p key={i} className={cn("py-1", i === ctx.previewSlideIdx && "bg-teal-500/10 rounded-md px-2 -mx-2")}>
                <span className="text-[10px] font-mono text-zinc-500 mr-2">{i + 1}</span>
                {s.kind === "text" ? s.text : `[${s.kind}]`}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ViewToggle({ current, onChange }: { current: ViewMode; onChange: (v: ViewMode) => void }) {
  const items: { key: ViewMode; icon: typeof Grid3x3; hint: string }[] = [
    { key: "grid", icon: Grid3x3, hint: "Grid view" },
    { key: "list", icon: List, hint: "List view" },
    { key: "text", icon: TypeIcon, hint: "Text view" },
  ];
  return (
    <div className="inline-flex items-center rounded-md border" style={{ borderColor: "#2a3232" }}>
      {items.map(({ key, icon: Icon, hint }) => {
        const on = current === key;
        return (
          <button key={key} title={hint} onClick={() => onChange(key)}
            className={cn(
              "h-7 w-7 inline-flex items-center justify-center border-r last:border-r-0",
              on ? "bg-teal-500/15 text-teal-200" : "text-zinc-400 hover:text-zinc-100 hover:bg-white/5",
            )}
            style={{ borderColor: "#2a3232" }}>
            <Icon className="w-3.5 h-3.5" />
          </button>
        );
      })}
    </div>
  );
}
