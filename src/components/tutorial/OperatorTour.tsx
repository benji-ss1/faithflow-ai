"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

/**
 * OperatorTour — 5-step in-app spotlight tour of the ProOperatorShell zones.
 *
 * Renders a semi-transparent backdrop with a rectangular cutout over each
 * target zone in sequence. Each zone is targeted by a `data-tour="<key>"`
 * attribute on the existing shell container. Kept dependency-free — no
 * external tour library.
 *
 * Auto-shows once per install (localStorage key `presentflow.tour.seen`)
 * on first Electron launch, and can be re-opened via the Help > Guided
 * Tutorial menu item (IPC channel `shell:open-tour`).
 *
 * R1: the SVG backdrop is `pointerEvents: none` end-to-end so it never
 * intercepts clicks on the highlighted zone. Operator advances via the
 * Next/Back/Skip buttons in the card, or arrow keys / Enter / Escape.
 */
type Step = {
  key: "left" | "center" | "right" | "bottom" | "top";
  title: string;
  body: string;
};

const STEPS: Step[] = [
  { key: "left", title: "Library and playlist", body: "Songs, Bible, and Media live on top. Your ordered service items live below. Click one to load its slides." },
  { key: "center", title: "Slide grid", body: "Slides for whatever is selected. Single click selects, double click sends live, right click opens options." },
  { key: "right", title: "Live preview and tabs", body: "What's on the projector right now, plus tabs for timer, messages, and stage settings." },
  { key: "bottom", title: "Transport and view", body: "Transitions, view options, and quick controls. The Send Live button is here too." },
  { key: "top", title: "Top bar", body: "Switch between Slides, Bible, Songs, and Media. AI Listening status shows on the far right." },
];

const SEEN_KEY = "presentflow.tour.seen";

export function OperatorTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);

  const step = useMemo(() => STEPS[idx], [idx]);

  useLayoutEffect(() => {
    if (!open) return;

    const measure = () => {
      const el = document.querySelector(`[data-tour="${step.key}"]`) as HTMLElement | null;
      targetRef.current = el;
      if (!el) { setRect(null); return; }
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    measure();

    // Y1: react to size + DOM mutations instead of a 300ms polling interval.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro && targetRef.current) ro.observe(targetRef.current);
    if (ro) ro.observe(document.body);

    const mo = typeof MutationObserver !== "undefined" ? new MutationObserver(() => {
      // Re-look up the target — it may have been (re)mounted after the initial
      // measure. Only re-measure if the target changed or its box moved.
      const el = document.querySelector(`[data-tour="${step.key}"]`) as HTMLElement | null;
      if (el !== targetRef.current) {
        if (ro && targetRef.current) ro.unobserve(targetRef.current);
        targetRef.current = el;
        if (ro && el) ro.observe(el);
        measure();
      }
    }) : null;
    mo?.observe(document.body, { childList: true, subtree: true });

    // Y2: capture-phase scroll listener so inner scroll containers also
    // trigger a re-measure. Passive since we never call preventDefault.
    const onScroll = () => measure();
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", measure);

    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [open, step.key]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // Y3: never swallow arrow keys / Enter when an input has focus — the
      // operator may be typing in the search box, lower-third editor, or a
      // contenteditable panel.
      const t = e.target;
      if (t instanceof HTMLElement) {
        if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return;
        if (t.isContentEditable) return;
      }
      if (e.key === "Escape") { e.stopPropagation(); finish(); }
      else if (e.key === "ArrowRight" || e.key === "Enter") { e.stopPropagation(); next(); }
      else if (e.key === "ArrowLeft") { e.stopPropagation(); back(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, idx]);

  if (!open) return null;

  function next() {
    if (idx < STEPS.length - 1) setIdx(idx + 1);
    else finish();
  }
  function back() {
    if (idx > 0) setIdx(idx - 1);
  }
  function finish() {
    try { window.localStorage.setItem(SEEN_KEY, "1"); } catch { /* noop */ }
    setIdx(0);
    onClose();
  }

  // Card position: below the highlighted rect when there's room, else above.
  // Always resolves to a `top` (never `bottom`) so the result can be clamped
  // directly against the viewport — the old below/above split could compute
  // a `bottom` value larger than the viewport height itself when the target
  // rect sat near the top edge (e.g. the "top" toolbar step), pushing the
  // card off-screen with no way to catch it.
  const CARD_HEIGHT_ESTIMATE = 180;
  const CARD_WIDTH_ESTIMATE = 380;
  const cardStyle: React.CSSProperties = (() => {
    if (!rect) return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
    const below = rect.top + rect.height + 12;
    const wantBelow = below + CARD_HEIGHT_ESTIMATE < vh;
    const desiredTop = wantBelow ? below : rect.top - 12 - CARD_HEIGHT_ESTIMATE;
    const top = Math.max(8, Math.min(vh - CARD_HEIGHT_ESTIMATE - 8, desiredTop));
    const left = Math.max(16, Math.min(vw - CARD_WIDTH_ESTIMATE - 16, rect.left));
    return { top, left };
  })();

  return (
    <div
      className="fixed inset-0 z-[9999]"
      aria-live="polite"
      role="dialog"
      aria-label="PresentFlow guided tour"
      // R1: overlay container itself must not intercept clicks; only the tour
      // card re-enables pointer events so operator can still interact with
      // the highlighted zone during the tour.
      style={{ pointerEvents: "none" }}
    >
      {/* R1: SVG dimmer + spotlight ring is purely decorative. pointerEvents:
          none end-to-end — no full-viewport click-eater. */}
      <svg
        width="100%"
        height="100%"
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        aria-hidden="true"
      >
        <defs>
          <mask id="tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {rect && (
              <rect
                x={Math.max(0, rect.left - 6)}
                y={Math.max(0, rect.top - 6)}
                width={rect.width + 12}
                height={rect.height + 12}
                rx={8}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.65)" mask="url(#tour-mask)" />
        {rect && (
          <rect
            x={Math.max(0, rect.left - 6)}
            y={Math.max(0, rect.top - 6)}
            width={rect.width + 12}
            height={rect.height + 12}
            rx={8}
            fill="none"
            stroke="rgb(99,102,241)"
            strokeWidth={2}
          />
        )}
      </svg>

      <div
        className="absolute w-[360px] max-w-[92vw] rounded-lg border border-border bg-card text-card-foreground shadow-2xl p-4"
        style={{ ...cardStyle, pointerEvents: "auto" }}
      >
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
          Step {idx + 1} of {STEPS.length}
        </div>
        <div className="text-base font-semibold mb-1">{step.title}</div>
        <div className="text-sm text-muted-foreground mb-3">{step.body}</div>
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={finish}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Skip tour
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={back}
              disabled={idx === 0}
              className="px-3 py-1.5 rounded-md border border-border text-sm disabled:opacity-40"
            >
              Back
            </button>
            <button
              type="button"
              onClick={next}
              className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium"
            >
              {idx === STEPS.length - 1 ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function hasSeenTour(): boolean {
  try { return window.localStorage.getItem(SEEN_KEY) === "1"; } catch { return false; }
}
