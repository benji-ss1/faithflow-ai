"use client";
// JPD Fix 7 (2026-07-27) — Hardware config surfaced in the LEFT sidebar.
// Operators configure Screens + Audio once at service start; field reports
// said the right-sidebar Settings popover was hard to find. This adds a
// HARDWARE section (below MEDIA) with two rows that open a 360px slide-out
// panel over the center grid. NO logic is duplicated: the panel mounts the
// existing <ScreensPanel /> and <AudioTab /> components as-is — both are
// prop-less and already share state with the right-sidebar paths via
// localStorage + window events, so both access points stay in sync.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, Mic, Monitor, X } from "lucide-react";
import { AudioTab } from "../right/tabs/AudioTab";
import { ScreensPanel } from "@/components/operator/screens/ScreensPanel";

type HardwareKey = "screens" | "audio";

export function HardwareSection() {
  const [open, setOpen] = useState(true);
  // Only one hardware panel open at a time — single key of state.
  const [panel, setPanel] = useState<HardwareKey | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // The slide-out anchors to the right edge of the left <aside>, spanning
  // its full height (i.e. over the center grid, below the top bar).
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);

  const measure = useCallback(() => {
    const aside = rootRef.current?.closest("aside");
    if (!aside) return;
    const r = aside.getBoundingClientRect();
    setAnchor({ top: r.top, left: r.right });
  }, []);

  // Measure on mount so the first open animates (panel starts off-screen).
  useEffect(() => { measure(); }, [measure]);

  const openPanel = useCallback((k: HardwareKey) => {
    setPanel((cur) => (cur === k ? null : k));
    measure();
  }, [measure]);

  // Esc closes; click outside (not on the trigger rows) closes.
  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanel(null);
    };
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (rootRef.current?.contains(t)) return;
      // Radix popovers/portals inside AudioTab render to document.body —
      // don't close the panel when interacting with them.
      const el = t instanceof Element ? t : null;
      if (el?.closest("[data-radix-popper-content-wrapper], [role='dialog']")) return;
      setPanel(null);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
      window.removeEventListener("resize", measure);
    };
  }, [panel, measure]);

  const rows: { k: HardwareKey; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
    { k: "screens", label: "Screens", Icon: Monitor },
    { k: "audio", label: "Audio", Icon: Mic },
  ];

  return (
    <section ref={rootRef} className="border-b border-[var(--color-border)]">
      <header className="flex items-center h-7 px-2 gap-1">
        <button
          type="button"
          className="flex items-center gap-1 flex-1 text-left"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <span className="eyebrow">Hardware</span>
        </button>
      </header>
      {open && (
        <ul className="pb-1">
          {rows.map(({ k, label, Icon }) => (
            <li key={k}>
              <button
                type="button"
                title={`Configure ${label.toLowerCase()}`}
                onClick={() => openPanel(k)}
                className={
                  panel === k
                    ? "w-full text-left px-2 py-1 text-[12px] text-[var(--color-foreground)] bg-white/5 flex items-center gap-1.5"
                    : "w-full text-left px-2 py-1 text-[12px] text-[var(--color-muted-foreground)] hover:bg-white/5 hover:text-[var(--color-foreground)] flex items-center gap-1.5"
                }
              >
                <Icon className="w-3 h-3 shrink-0" />
                <span>{label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* 2026-07-30 fix — was ALWAYS-mounted with a CSS transform hiding it
          off-screen when closed. Any race between measure() and the transform
          application (or a CSS specificity clash from a parent layout) let
          the panel render VISIBLE without the user ever clicking Audio or
          Screens. Result: an "empty black column with an X close button"
          appeared over the center area, blocking the sidebar. Now the panel
          only mounts when there IS a selected hardware key — no phantom
          render, no timing race, and device-enumeration side-effects still
          don't run in the background. */}
      {panel !== null && typeof document !== "undefined" && anchor && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label={panel === "audio" ? "Audio hardware" : "Screens hardware"}
          className="fixed w-[360px] bg-[var(--color-elevated)] border-r border-[var(--color-border)] shadow-2xl flex flex-col z-40"
          style={{
            top: anchor.top,
            bottom: 0,
            left: anchor.left,
          }}
        >
          <div className="flex items-center justify-between px-3 h-8 border-b border-[var(--color-border)] shrink-0">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-muted-foreground)]">
              {panel === "audio" ? "Audio" : "Screens"}
            </span>
            <button
              type="button"
              onClick={() => setPanel(null)}
              aria-label="Close"
              className="text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto pf-transcript-scroll p-2 text-[12px]">
            {panel === "screens" && <ScreensPanel />}
            {panel === "audio" && <AudioTab />}
          </div>
        </div>,
        document.body,
      )}
    </section>
  );
}
