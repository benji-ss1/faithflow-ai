"use client";
import { useEffect, useState } from "react";
import { Send, Square, Sun, XCircle, Eraser, Image as ImageIcon, Type, MessageSquare, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OperatorShellCtx } from "./types";

export function ActionBar({ ctx }: { ctx: OperatorShellCtx }) {
  const [narrow, setNarrow] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    const check = () => setNarrow(window.innerWidth < 1200);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return (
    <div className="h-12 shrink-0 border-t flex items-center gap-1.5 px-3 relative"
      style={{ borderColor: "#2a3232", background: "#1a2020" }}>
      <Btn onClick={ctx.onSendToLive} tone="teal" label="Send to Live" hint="Push preview to Live"
        icon={<Send className="w-3.5 h-3.5" />} />
      <div className="w-px h-6 mx-1" style={{ background: "#2a3232" }} />
      <Btn onClick={ctx.onBlank} tone="neutral" label="Blank" icon={<Square className="w-3.5 h-3.5" />} />
      <Btn onClick={ctx.onLogo}  tone="neutral" label="Logo"  icon={<Sun className="w-3.5 h-3.5" />} />
      <Btn onClick={ctx.onKill}  tone="danger"  label="Kill Output" hint="Immediately clear Live"
        icon={<XCircle className="w-3.5 h-3.5" />} />
      <div className="w-px h-6 mx-1" style={{ background: "#2a3232" }} />

      {!narrow ? (
        <>
          <Btn onClick={ctx.onClearSlide}       tone="ghost" label="Clear Slide"       icon={<Eraser className="w-3 h-3" />} small />
          <Btn onClick={ctx.onClearMedia}       tone="ghost" label="Clear Media"       icon={<ImageIcon className="w-3 h-3" />} small />
          <Btn onClick={ctx.onClearLowerThird}  tone="ghost" label="Clear Lower Third" icon={<Type className="w-3 h-3" />} small />
          <Btn onClick={ctx.onStageMessage}     tone="ghost" label="Stage Message"     icon={<MessageSquare className="w-3 h-3" />} small />
        </>
      ) : (
        <div className="relative">
          <button onClick={() => setMoreOpen((v) => !v)} title="More actions"
            className="h-8 px-2 rounded-md border text-[10px] font-bold uppercase tracking-wider text-zinc-300 hover:bg-white/5 inline-flex items-center gap-1"
            style={{ borderColor: "#2a3232" }}>
            <MoreHorizontal className="w-3.5 h-3.5" /> More
          </button>
          {moreOpen && (
            <div className="absolute left-0 bottom-10 z-40 w-56 rounded-md border shadow-lg p-1"
              style={{ borderColor: "#2a3232", background: "#232b2b" }}>
              <MoreItem onClick={() => { ctx.onClearSlide(); setMoreOpen(false); }} label="Clear Slide" />
              <MoreItem onClick={() => { ctx.onClearMedia(); setMoreOpen(false); }} label="Clear Media" />
              <MoreItem onClick={() => { ctx.onClearLowerThird(); setMoreOpen(false); }} label="Clear Lower Third" />
              <MoreItem onClick={() => { ctx.onStageMessage(); setMoreOpen(false); }} label="Stage Message" />
            </div>
          )}
        </div>
      )}

      <div className="ml-auto text-[10px] font-mono text-zinc-500">
        {ctx.plan.items[ctx.previewItemIdx]?.title || ""}
        {" · "}
        Slide {ctx.previewSlideIdx + 1}
      </div>
    </div>
  );
}

function Btn({ onClick, label, hint, tone, icon, small }: {
  onClick: () => void; label: string; hint?: string;
  tone: "teal" | "neutral" | "danger" | "ghost"; icon?: React.ReactNode; small?: boolean;
}) {
  const tones: Record<string, string> = {
    teal:    "bg-teal-500/20 border-teal-500/60 text-teal-100 hover:bg-teal-500/30",
    neutral: "border-[#2a3232] text-zinc-200 bg-[#232b2b] hover:bg-white/5",
    danger:  "border-red-500/60 text-red-300 hover:bg-red-500/10",
    ghost:   "border-transparent text-zinc-400 hover:text-zinc-100 hover:bg-white/5",
  };
  const size = small ? "h-7 px-2 text-[10px]" : "h-8 px-3 text-[11px]";
  return (
    <button onClick={onClick} title={hint || label}
      className={cn("rounded-md border font-bold uppercase tracking-wider inline-flex items-center gap-1.5 whitespace-nowrap", size, tones[tone])}>
      {icon}
      {label}
    </button>
  );
}

function MoreItem({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button onClick={onClick}
      className="w-full h-8 px-2 rounded-md text-left text-[11px] text-zinc-200 hover:bg-white/5">
      {label}
    </button>
  );
}
