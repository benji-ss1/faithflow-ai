"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Floating access button for the Projection Zone Customizer. Lives on the
 * OPERATOR control screen only (never the projector output). Pulses gently for
 * the first few launches when no custom profile exists yet, to advertise the
 * feature (spec §3 first-time experience).
 *
 * The button is DRAGGABLE — the operator can park it anywhere on their control
 * screen and the position persists per-machine (localStorage). A small drag
 * threshold distinguishes a reposition-drag from a plain click (which opens the
 * editor). Position is stored as top-left px and re-clamped into the viewport
 * on mount and on resize so it can never end up off-screen.
 */
const PULSE_KEY = "presentflow.projectionZones.pulseCount.v1";
const POS_KEY = "presentflow.projectionZones.buttonPos.v1";
const BTN = 36; // w-9 / h-9
const MARGIN = 16;
const DRAG_THRESHOLD = 4; // px before a press becomes a drag

type Pos = { x: number; y: number };

function clampPos(p: Pos): Pos {
  if (typeof window === "undefined") return p;
  const maxX = Math.max(MARGIN, window.innerWidth - BTN - MARGIN);
  const maxY = Math.max(MARGIN, window.innerHeight - BTN - MARGIN);
  return { x: Math.min(Math.max(MARGIN, p.x), maxX), y: Math.min(Math.max(MARGIN, p.y), maxY) };
}

function defaultPos(): Pos {
  if (typeof window === "undefined") return { x: 0, y: 0 };
  // Mirror the old anchor: right: 16, bottom: 56.
  return clampPos({ x: window.innerWidth - BTN - MARGIN, y: window.innerHeight - BTN - 56 });
}

function readPos(): Pos {
  if (typeof window === "undefined") return { x: 0, y: 0 };
  try {
    const raw = window.localStorage.getItem(POS_KEY);
    if (raw) {
      const o = JSON.parse(raw) as Partial<Pos>;
      if (typeof o.x === "number" && typeof o.y === "number") return clampPos({ x: o.x, y: o.y });
    }
  } catch { /* noop */ }
  return defaultPos();
}

export function ZoneToolbarButton({ onOpen, hasCustomProfile }: { onOpen: () => void; hasCustomProfile: boolean }) {
  const [pulse, setPulse] = useState(false);
  const [pos, setPos] = useState<Pos>({ x: 0, y: 0 });
  const [ready, setReady] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number; moved: boolean } | null>(null);

  // Seed position once the window exists (avoids SSR/hydration mismatch).
  useEffect(() => {
    setPos(readPos());
    setReady(true);
  }, []);

  // Keep it on-screen when the window resizes.
  useEffect(() => {
    const onResize = () => setPos((p) => clampPos(p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (hasCustomProfile) return; // already set up → no attention pulse
    try {
      const n = Number(window.localStorage.getItem(PULSE_KEY) ?? "0");
      if (n < 3) {
        setPulse(true);
        window.localStorage.setItem(PULSE_KEY, String(n + 1));
      }
    } catch { /* noop */ }
  }, [hasCustomProfile]);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    d.moved = true;
    setDragging(true);
    setPulse(false);
    setPos(clampPos({ x: d.baseX + dx, y: d.baseY + dy }));
  }, []);

  const onPointerUp = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    setDragging(false);
    if (d && !d.moved) {
      // A clean click (no drag) → open the editor.
      setPulse(false);
      onOpen();
      return;
    }
    // Persist the parked position.
    setPos((p) => {
      const clamped = clampPos(p);
      try { window.localStorage.setItem(POS_KEY, JSON.stringify(clamped)); } catch { /* noop */ }
      return clamped;
    });
    e.preventDefault();
  }, [onOpen, onPointerMove]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: pos.x, baseY: pos.y, moved: false };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  if (!ready) return null;

  return (
    <>
      <style>{`@keyframes pf-zone-pulse{0%,100%{box-shadow:0 0 0 0 rgba(255,122,44,0.0)}50%{box-shadow:0 0 0 6px rgba(255,122,44,0.35)}}`}</style>
      <button
        type="button"
        onPointerDown={onPointerDown}
        title="Projection Zone — click to open, drag to move"
        aria-label="Projection Zone (draggable)"
        className="fixed z-[150] w-9 h-9 rounded-full flex items-center justify-center transition-colors touch-none select-none"
        style={{
          left: pos.x,
          top: pos.y,
          background: "rgba(15,15,17,0.85)",
          border: "1px solid rgba(255,122,44,0.55)",
          color: "#ff7a2c",
          cursor: dragging ? "grabbing" : "grab",
          animation: pulse && !dragging ? "pf-zone-pulse 1.8s ease-in-out infinite" : undefined,
        }}
        onMouseEnter={(e) => { if (!dragging) e.currentTarget.style.background = "rgba(255,122,44,0.20)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(15,15,17,0.85)"; }}
      >
        {/* resize / layout glyph */}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 3v18M3 9h18" opacity="0.5" />
        </svg>
      </button>
    </>
  );
}
