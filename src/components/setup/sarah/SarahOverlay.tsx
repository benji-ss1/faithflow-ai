"use client";

/**
 * SarahOverlay — hosts Sarah INSIDE the desktop operator shell (2026-09-16).
 *
 * Two modes:
 *   • panel — the spotlight panel (Sarah's conversation), centred over a light scrim.
 *   • coach — the panel steps aside (kept MOUNTED, so no progress is lost) while
 *     SarahSpotlight glides around the real app: the Audio panel, the AI switch,
 *     the live preview.
 *
 * Not a Radix modal on purpose: no focus trap, so Sarah coaching the real app never
 * locks the operator out of it. Opened by `presentflow:open-sarah`; renders nothing
 * until then.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SarahSetupWizard, type SarahLive } from "./SarahSetupWizard";

export const OPEN_SARAH_EVENT = "presentflow:open-sarah";

export function SarahOverlay({ live }: { live?: SarahLive } = {}) {
  const [open, setOpen] = useState(false);
  const [coaching, setCoaching] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onOpen = () => { setCoaching(false); setOpen(true); };
    window.addEventListener(OPEN_SARAH_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SARAH_EVENT, onOpen);
  }, []);

  const close = useCallback(() => { setOpen(false); setCoaching(false); }, []);

  // Esc closes the panel only when focus is inside it — slide hotkeys elsewhere are untouched.
  useEffect(() => {
    if (!open || coaching) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && panelRef.current?.contains(document.activeElement)) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, coaching, close]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <>
      <div hidden={coaching} aria-hidden className="fixed inset-0 z-[90] bg-black/45 backdrop-blur-[2px]" />
      <div
        ref={panelRef}
        hidden={coaching}
        role="dialog"
        aria-modal="true"
        aria-label="Audio setup with Sarah"
        className="fixed z-[91] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(1060px,92vw)] h-[min(660px,86vh)] rounded-3xl overflow-hidden shadow-[0_40px_120px_rgba(0,0,0,0.6)] ring-1 ring-white/10"
      >
        <SarahSetupWizard onDone={close} live={live} onCoachChange={setCoaching} />
      </div>
    </>,
    document.body,
  );
}
