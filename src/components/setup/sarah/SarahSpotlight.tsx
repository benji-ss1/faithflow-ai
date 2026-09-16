"use client";

/**
 * SarahSpotlight — the console dims, a lit cutout GLIDES to a real part of the app,
 * and Sarah coaches beside it (2026-09-16).
 *
 * Built on the pattern of tutorial/OperatorTour.tsx (SVG mask, ResizeObserver,
 * re-query for late-mounting targets) with a spring glide and a live-service-safe
 * contract:
 *   • The dim layer is `pointer-events: none` — NOTHING outside Sarah's card is ever
 *     blocked, so the operator can still drive the projector mid-lesson.
 *   • No window keydown capture. Esc closes only when focus is inside Sarah's card, so
 *     slide hotkeys (arrows, Enter, space) are never swallowed.
 *   • Not a modal: `role="dialog" aria-modal="false"`, no focus trap.
 *   • The glide writes SVG attributes through refs — zero React renders per frame.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { settled, stepSpring, type Rect, type SpringState } from "@/lib/audio/spring";
import type { SarahMood } from "./SarahAvatar";

const PAD = 8;
const CARD_W = 340;
const CARD_H_EST = 230;
const GAP = 18;

const FACE: Record<SarahMood, string> = {
  neutral: "/sarah/sarah-neutral.png", think: "/sarah/sarah-think.png", nod: "/sarah/sarah-nod.png",
  listen: "/sarah/sarah-listen.png", ooh: "/sarah/sarah-ooh.png", focus: "/sarah/sarah-neutral.png",
  celebrate: "/sarah/sarah-celebrate.png",
};

export type SpotlightAction = { label: string; onClick: () => void; primary?: boolean; disabled?: boolean };

export interface SarahSpotlightProps {
  /** `data-tour` value of the region to light up. null = centred card, no cutout. */
  target: string | null;
  mood: SarahMood;
  title: string;
  body: string;
  /** Extra live content under the body (a level meter, a transcript line…). */
  children?: React.ReactNode;
  actions?: SpotlightAction[];
  onClose: () => void;
}

function readRect(key: string | null): Rect | null {
  if (!key || typeof document === "undefined") return null;
  const el = document.querySelector(`[data-tour="${key}"]`) as HTMLElement | null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  return { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 };
}

/** Place the card beside the target: right, then left, then below, then above; always on-screen. */
export function placeCard(rect: Rect | null, vw: number, vh: number, cw = CARD_W, ch = CARD_H_EST): { left: number; top: number } {
  const clampX = (x: number) => Math.max(12, Math.min(vw - cw - 12, x));
  const clampY = (y: number) => Math.max(12, Math.min(vh - ch - 12, y));
  if (!rect) return { left: clampX((vw - cw) / 2), top: clampY((vh - ch) / 2) };
  const midY = rect.y + rect.h / 2 - ch / 2;
  if (rect.x + rect.w + GAP + cw <= vw - 12) return { left: rect.x + rect.w + GAP, top: clampY(midY) };
  if (rect.x - GAP - cw >= 12) return { left: rect.x - GAP - cw, top: clampY(midY) };
  if (rect.y + rect.h + GAP + ch <= vh - 12) return { left: clampX(rect.x + rect.w / 2 - cw / 2), top: rect.y + rect.h + GAP };
  return { left: clampX(rect.x + rect.w / 2 - cw / 2), top: clampY(rect.y - GAP - ch) };
}

export function SarahSpotlight({ target, mood, title, body, children, actions = [], onClose }: SarahSpotlightProps) {
  const [mounted, setMounted] = useState(false);
  const [hasTarget, setHasTarget] = useState(false);
  const [card, setCard] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const holeRef = useRef<SVGRectElement | null>(null);
  const ringRef = useRef<SVGRectElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const targetRectRef = useRef<Rect | null>(null);
  const springRef = useRef<SpringState | null>(null);
  const rafRef = useRef<number>(0);
  const reduced = useRef(false);

  useEffect(() => {
    setMounted(true);
    reduced.current = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  const paint = (r: Rect) => {
    for (const el of [holeRef.current, ringRef.current]) {
      if (!el) continue;
      el.setAttribute("x", String(r.x)); el.setAttribute("y", String(r.y));
      el.setAttribute("width", String(Math.max(0, r.w))); el.setAttribute("height", String(Math.max(0, r.h)));
    }
  };

  // Measure the target and keep it measured while it moves, resizes or remounts.
  useLayoutEffect(() => {
    if (!mounted) return;
    let observed: HTMLElement | null = null;
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => measure()) : null;

    const animate = () => {
      const tgt = targetRectRef.current;
      if (!tgt) return;
      let last = performance.now();
      const tick = (now: number) => {
        const cur = springRef.current;
        const t = targetRectRef.current;
        if (!cur || !t) return;
        const next = stepSpring(cur, t, (now - last) / 1000);
        last = now;
        springRef.current = next;
        paint(next.pos);
        if (!settled(next, t)) rafRef.current = requestAnimationFrame(tick);
        else { springRef.current = { pos: t, vel: { x: 0, y: 0, w: 0, h: 0 } }; paint(t); }
      };
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };

    function measure() {
      const el = target ? (document.querySelector(`[data-tour="${target}"]`) as HTMLElement | null) : null;
      if (el !== observed) {
        if (ro && observed) ro.unobserve(observed);
        observed = el;
        if (ro && el) ro.observe(el);
      }
      const r = readRect(target);
      targetRectRef.current = r;
      setHasTarget(!!r);
      setCard(placeCard(r, window.innerWidth, window.innerHeight, CARD_W, cardRef.current?.offsetHeight || CARD_H_EST));
      if (!r) return;
      if (!springRef.current || reduced.current) {
        // First appearance (or reduced motion): start slightly larger and settle in.
        springRef.current = reduced.current
          ? { pos: r, vel: { x: 0, y: 0, w: 0, h: 0 } }
          : { pos: { x: r.x - 24, y: r.y - 24, w: r.w + 48, h: r.h + 48 }, vel: { x: 0, y: 0, w: 0, h: 0 } };
        paint(springRef.current.pos);
        if (reduced.current) return;
      }
      animate();
    }

    measure();
    const mo = typeof MutationObserver !== "undefined" ? new MutationObserver(() => {
      const el = target ? document.querySelector(`[data-tour="${target}"]`) : null;
      if (el !== observed) measure();
    }) : null;
    mo?.observe(document.body, { childList: true, subtree: true });
    const onScroll = () => measure();
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(rafRef.current);
      ro?.disconnect(); mo?.disconnect();
      window.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
      window.removeEventListener("resize", measure);
    };
  }, [mounted, target]);

  // Esc closes ONLY when focus is inside Sarah's card — never steals operator hotkeys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (cardRef.current && cardRef.current.contains(document.activeElement)) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <>
      {/* Dim + cutout. Purely visual: pointer-events none, so every control stays usable. */}
      <svg aria-hidden className="fixed inset-0 z-[85] w-screen h-screen" style={{ pointerEvents: "none" }}>
        <defs>
          <mask id="sarah-spotlight-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {hasTarget && <rect ref={holeRef} rx="14" ry="14" fill="black" />}
          </mask>
        </defs>
        <rect x="0" y="0" width="100%" height="100%" fill="rgba(8,7,6,0.62)" mask="url(#sarah-spotlight-mask)"
          style={{ transition: "fill 300ms ease" }} />
        {hasTarget && (
          <rect ref={ringRef} rx="14" ry="14" fill="none" stroke="#ff8a52" strokeWidth="2"
            style={{ filter: "drop-shadow(0 0 18px rgba(232,80,26,0.55))" }} />
        )}
      </svg>

      {/* Sarah's coach card */}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="false"
        aria-label={`Sarah: ${title}`}
        className="fixed z-[92] rounded-2xl border border-white/10 bg-[rgba(18,16,14,0.94)] text-[#ece7e0] shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-md"
        style={{
          width: CARD_W, left: card.left, top: card.top,
          transition: reduced.current ? "none" : "left 420ms cubic-bezier(0.2,0.8,0.2,1), top 420ms cubic-bezier(0.2,0.8,0.2,1)",
        }}
      >
        <div className="flex items-start gap-3 p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img key={mood} src={FACE[mood]} alt="" aria-hidden
            className="flex-none w-12 h-12 rounded-full object-cover border-2 border-[#e8501a] shadow-[0_0_18px_rgba(232,80,26,0.35)]" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#ff8a52]">Sarah</span>
              <button type="button" onClick={onClose} aria-label="Close Sarah"
                className="w-6 h-6 grid place-items-center rounded-md text-[#b9b1a6] hover:text-[#ece7e0] hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff8a52]">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="mt-0.5 text-[15px] font-semibold leading-snug" aria-live="polite">{title}</div>
            <p className="mt-1 text-[13px] leading-relaxed text-[#cfc7bc]">{body}</p>
            {children && <div className="mt-3">{children}</div>}
          </div>
        </div>
        {actions.length > 0 && (
          <div className="flex flex-wrap justify-end gap-2 px-4 pb-4">
            {actions.map((a) => (
              <button key={a.label} type="button" onClick={a.onClick} disabled={a.disabled}
                className={`h-9 px-4 rounded-lg text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff8a52] disabled:opacity-40 ${
                  a.primary ? "bg-[#e8501a] text-white hover:bg-[#ff6a36]" : "border border-white/15 text-[#ece7e0] hover:bg-white/10"}`}>
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
