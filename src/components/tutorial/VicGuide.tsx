"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, MessageCircle, X } from "lucide-react";

type Step = { target: string; title: string; body: string; question?: string };

// The guide deliberately targets stable shell zones, not fragile icon paths.
// More granular targets can be added as each control receives a data-vic marker.
const STEPS: Step[] = [
  { target: "top", title: "Your control room", body: "I’m Vic — co-founder and technical guide. I’ll show you the parts that matter on a real service day." },
  { target: "left", title: "Library and plan", body: "Songs, Bible, Media and Themes start here. The lower half is the running order for this service." },
  { target: "center", title: "Slides and media", body: "This is your working surface. Select a slide to preview it; use the Media Bin to send, frame or place visuals." },
  { target: "right", title: "What is live", body: "This panel is your live confidence check: projector content, messages, timers, screens and output controls." },
  { target: "bottom", title: "Send safely", body: "Transport, transitions and live controls live here. Nothing goes to the congregation until you choose to send it." },
  { target: "left", title: "Songs and Bible", body: "Choose a song or passage, then build the sequence slide by slide. Themes style the whole look without changing your words." },
  { target: "center", title: "Media Bin", body: "Every image and video here can be edited before it is used. Saved framing is what you should expect on the projector." },
  { target: "right", title: "Screens and video input", body: "Set the main projector, stage display and camera/video input independently so the room and platform see the right thing.", question: "Do you have a stage display connected?" },
  { target: "right", title: "Stage and main output", body: "Main is for the congregation; Stage is for your team. Start with Main, then add Stage when its screen is connected." },
  { target: "top", title: "You’re ready", body: "Use this guide again any time from Settings → Help. Ask a question to jump to the relevant part of PresentFlow." },
];

export function VicGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const target = useMemo(() => STEPS[index], [index]);
  const targetRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const el = document.querySelector(`[data-tour="${target.target}"]`) as HTMLElement | null;
      targetRef.current = el;
      setRect(el?.getBoundingClientRect() ?? null);
    };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(document.body);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [open, target.target]);

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") setIndex((n) => Math.max(0, n - 1));
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index]);
  if (!open) return null;
  const close = () => { try { localStorage.setItem("presentflow.vic.guide.seen", "1"); } catch {} setIndex(0); onClose(); };
  const next = () => index === STEPS.length - 1 ? close() : setIndex((n) => n + 1);
  const vw = typeof window === "undefined" ? 1200 : window.innerWidth;
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  const top = rect ? Math.max(12, Math.min(vh - 174, rect.bottom + 12 > vh - 174 ? rect.top - 174 : rect.bottom + 12)) : vh / 2 - 80;
  const left = rect ? Math.max(12, Math.min(vw - 380, rect.left)) : vw / 2 - 180;
  return <div className="fixed inset-0 z-[10000]" style={{ pointerEvents: "none" }} role="dialog" aria-label="Vic technical guide">
    <svg className="absolute inset-0 h-full w-full" aria-hidden><defs><mask id="vic-cutout"><rect width="100%" height="100%" fill="white" />{rect && <rect x={rect.left - 5} y={rect.top - 5} width={rect.width + 10} height={rect.height + 10} rx="10" fill="black" />}</mask></defs><rect width="100%" height="100%" fill="rgba(0,0,0,.62)" mask="url(#vic-cutout)" />{rect && <rect x={rect.left - 5} y={rect.top - 5} width={rect.width + 10} height={rect.height + 10} rx="10" fill="none" stroke="#f97316" strokeWidth="2" />}</svg>
    <section className="absolute w-[360px] max-w-[calc(100vw-24px)] rounded-xl border border-white/15 bg-[#151312]/95 p-3 shadow-2xl backdrop-blur" style={{ top, left, pointerEvents: "auto" }}>
      <div className="flex items-center gap-2"><div className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-violet-500 via-fuchsia-500 to-orange-400 text-sm font-black text-white">V</div><div className="min-w-0 flex-1"><div className="text-sm font-semibold text-white">Vic <span className="font-normal text-white/50">· Co-founder & Technical Guide</span></div><div className="text-[10px] uppercase tracking-widest text-orange-300">{index + 1} / {STEPS.length}</div></div><button onClick={close} className="text-white/55 hover:text-white" aria-label="Close Vic guide"><X className="size-4" /></button></div>
      <div className="mt-2 rounded-lg bg-white/5 px-3 py-2"><p className="text-xs font-semibold text-white">{target.title}</p><p className="mt-1 text-xs leading-relaxed text-white/65">{target.body}</p>{target.question && <button className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-orange-300 hover:text-orange-200"><MessageCircle className="size-3" /> {target.question}</button>}</div>
      <div className="mt-3 flex items-center gap-2"><button onClick={() => setIndex((n) => Math.max(0, n - 1))} disabled={!index} className="rounded-md px-2 py-1 text-xs text-white/65 disabled:opacity-30"><ChevronLeft className="inline size-3" /> Back</button><div className="flex flex-1 gap-1">{STEPS.map((_, i) => <i key={i} className={`h-1 flex-1 rounded ${i <= index ? "bg-orange-400" : "bg-white/15"}`} />)}</div><button onClick={next} className="rounded-md bg-orange-500 px-2.5 py-1 text-xs font-semibold text-white">{index === STEPS.length - 1 ? "Done" : <>Next <ChevronRight className="inline size-3" /></>}</button></div>
    </section>
  </div>;
}
