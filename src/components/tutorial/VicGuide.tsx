"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Compass, X } from "lucide-react";

type Route = { centerMode?: "slides" | "songs" | "bible" | "media" | "transitions"; mediaBinOpen?: boolean; hardware?: "screens" | "video"; themes?: boolean };
type Step = { target: string; title: string; body: string; task: string; route?: Route; question?: string };

// Every step has a narrow, real target. Routes change the real workspace
// first, so the guide never describes a control the operator cannot see.
const STEPS: Step[] = [
  { target: "tab-songs", title: "Welcome to your control room", body: "I’m Vic — PresentFlow co-founder and technical guide. We will use the actual controls together, not a mock screen.", task: "Click Songs to open your song library.", route: { centerMode: "songs" } },
  { target: "tab-songs", title: "Songs", body: "Find, open and add songs here. Opening one takes you to its slides, where you can arrange and send each line with confidence.", task: "Choose any song row and look at its preview before continuing.", route: { centerMode: "songs" } },
  { target: "tab-bible", title: "Bible", body: "Bible is a real lookup workspace, not just a search. Choose a translation, enter a reference, then decide what reaches the projector.", task: "Try entering John 3:16, then press Lookup.", route: { centerMode: "bible" } },
  { target: "tab-media", title: "Media library", body: "Images and videos live here. Open an item to preview it, edit framing before use, or add it to your running order.", task: "Open Media and select an asset to inspect its options.", route: { centerMode: "media" } },
  { target: "themes", title: "Themes", body: "Themes control the look of lyrics and scripture. Choose a theme only after checking its preview—the words stay yours; the design changes.", task: "Open Themes and browse without applying one yet.", route: { centerMode: "media", themes: true } },
  { target: "media-bin", title: "Media Bin", body: "This is the fast service-day dock. A saved crop, fit or blur should look the same here, in the slide, and on the projector.", task: "Double-click an image to preview it, or right-click to find Edit image and background actions.", route: { centerMode: "slides", mediaBinOpen: true } },
  { target: "right", title: "Live confidence", body: "This is the control-side view of what is live. Check it before sending, then use layer controls deliberately—each layer can be cleared independently.", task: "Compare this preview with the slide you have selected; do not clear anything during this tour.", route: { centerMode: "slides" } },
  { target: "hardware-screens", title: "Main and Stage screens", body: "Screens is where Main (the congregation) and Stage (your team) are configured independently. The guide opens the real setup panel for you.", task: "Open Screens and identify the display you want as Main.", route: { hardware: "screens" }, question: "Do you have a separate stage display connected?" },
  { target: "hardware-video", title: "Video Input", body: "Use Video Input for a camera or capture device. It is separate from Main and Stage output, so a camera cannot accidentally replace the projector feed.", task: "Open Video Input and check whether your camera appears—do not change a live source during service.", route: { hardware: "video" } },
  { target: "transport", title: "Transitions and transport", body: "The lower controls handle the pace of your service: transitions, previous/next, video pause and Blank. They act on the real live pipeline.", task: "Use the Transitions area to browse a transition; leave a live output alone while practising.", route: { centerMode: "transitions" } },
  { target: "send-live", title: "Send live deliberately", body: "This is the send control. Preview first; then use it when the room is ready. It is intentionally a small, precise target—not a whole panel.", task: "Hover over Send to live and read its label. Do not press it unless you want to change the projector.", route: { centerMode: "slides" } },
  { target: "tab-songs", title: "You’re ready", body: "You can restart Vic any time in Settings → Help. Soon he will also answer in-depth questions and offer voice guidance.", task: "Restart this guide whenever you are learning a new part of PresentFlow.", route: { centerMode: "slides" } },
];

const SEEN_KEY = "presentflow.vic.guide.seen";
const dispatchRoute = (route?: Route) => { if (route) window.dispatchEvent(new CustomEvent("presentflow:vic:navigate", { detail: route })); };

export function VicGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const target = useMemo(() => STEPS[index], [index]);
  const close = useCallback(() => { try { localStorage.setItem(SEEN_KEY, "1"); } catch {} setIndex(0); onClose(); }, [onClose]);
  const back = useCallback(() => setIndex((value) => Math.max(0, value - 1)), []);
  const next = useCallback(() => setIndex((value) => value === STEPS.length - 1 ? value : value + 1), []);

  useEffect(() => {
    if (!open) return;
    dispatchRoute(target.route);
    const frame = requestAnimationFrame(() => dispatchRoute(target.route));
    return () => cancelAnimationFrame(frame);
  }, [open, target]);

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => setRect((document.querySelector(`[data-vic="${target.target}"]`) as HTMLElement | null)?.getBoundingClientRect() ?? null);
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(document.body);
    const mo = new MutationObserver(measure); mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", measure); window.addEventListener("scroll", measure, true);
    return () => { ro?.disconnect(); mo.disconnect(); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [open, target.target]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement | null;
      if (element && (element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.isContentEditable)) return;
      if (event.key === "Escape") close(); else if (event.key === "ArrowRight") next(); else if (event.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [back, close, next, open]);

  if (!open) return null;
  const vw = typeof window === "undefined" ? 1280 : window.innerWidth;
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  const cardHeight = 220;
  const top = rect ? Math.max(12, Math.min(vh - cardHeight - 12, rect.bottom + 14 > vh - cardHeight ? rect.top - cardHeight - 14 : rect.bottom + 14)) : 24;
  const left = rect ? Math.max(12, Math.min(vw - 368, rect.left)) : 24;

  return <div className="fixed inset-0 z-[10000]" style={{ pointerEvents: "none" }} role="dialog" aria-label="Vic technical guide" aria-live="polite">
    {/* No full-screen dimmer or blur: users must see and use the real app. */}
    {rect && <div className="absolute rounded-xl border-2 border-orange-400 shadow-[0_0_0_4px_rgba(249,115,22,.18),0_0_30px_rgba(249,115,22,.38)]" style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }} aria-hidden />}
    <section className="absolute w-[356px] max-w-[calc(100vw-24px)] rounded-xl border border-white/15 bg-[#171311]/[.98] p-3 shadow-2xl" style={{ top, left, pointerEvents: "auto" }}>
      <div className="flex items-center gap-2"><img src="/marketing/vic-guide-avatar.png" alt="Vic" className="size-9 shrink-0 rounded-full border border-orange-300/70 object-cover object-top" /><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-white">Vic <span className="font-normal text-white/55">· Co-founder & Technical Guide</span></p><p className="text-[10px] font-medium uppercase tracking-[.16em] text-orange-300">Step {index + 1} of {STEPS.length}</p></div><button onClick={close} className="rounded p-1 text-white/55 hover:bg-white/10 hover:text-white" aria-label="Close Vic guide"><X className="size-4" /></button></div>
      <div className="mt-2 rounded-lg border border-white/8 bg-white/5 px-3 py-2.5"><p className="text-xs font-semibold text-white">{target.title}</p><p className="mt-1 text-xs leading-relaxed text-white/70">{target.body}</p>{target.question && <p className="mt-2 rounded-md bg-orange-400/10 px-2 py-1.5 text-xs font-medium text-orange-200">{target.question}</p>}</div>
      <div className="mt-2 flex gap-2 rounded-lg bg-orange-400/10 px-2.5 py-2 text-xs text-orange-100"><Compass className="mt-0.5 size-3.5 shrink-0 text-orange-300" /><span><b>Try it:</b> {target.task}</span></div>
      <div className="mt-3 flex items-center gap-2"><button onClick={back} disabled={index === 0} className="rounded-md px-2 py-1 text-xs text-white/65 hover:text-white disabled:opacity-30"><ChevronLeft className="inline size-3" /> Back</button><div className="flex flex-1 gap-1">{STEPS.map((_, value) => <i key={value} className={`h-1 flex-1 rounded ${value <= index ? "bg-orange-400" : "bg-white/15"}`} />)}</div><button onClick={index === STEPS.length - 1 ? close : next} className="rounded-md bg-orange-500 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-orange-400">{index === STEPS.length - 1 ? <><Check className="mr-1 inline size-3" />Done</> : <>I tried it <ChevronRight className="inline size-3" /></>}</button></div>
    </section>
  </div>;
}
