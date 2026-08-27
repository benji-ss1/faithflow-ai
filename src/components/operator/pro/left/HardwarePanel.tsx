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
import { ChevronDown, ChevronRight, Mic, Monitor, Video, X } from "lucide-react";
import { AudioTab } from "../right/tabs/AudioTab";
import { ScreensPanel } from "@/components/operator/screens/ScreensPanel";
import { VideoInputPanel } from "./VideoInputPanel";

type HardwareKey = "screens" | "audio" | "video";

const HARDWARE_LABELS: Record<HardwareKey, string> = { screens: "Screens", audio: "Audio", video: "Video Input" };

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
    { k: "video", label: "Video Input", Icon: Video },
  ];

  return (
    <section ref={rootRef} className="border-b border-[var(--color-border)]">
      <header className="flex items-center h-8 px-2.5 gap-1 bg-[linear-gradient(180deg,var(--color-panel),transparent)]">
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
                    ? "w-full text-left mx-0 px-2 py-1.5 rounded-md text-[12.5px] font-semibold text-[var(--color-foreground)] bg-[var(--color-elevated)] border-l-[3px] border-[var(--color-brand)] flex items-center gap-2 transition-colors"
                    : "group/hw w-full text-left px-2 py-1.5 rounded-md text-[12.5px] font-medium text-[var(--color-muted-foreground)] border-l-[3px] border-transparent hover:bg-white/[0.05] hover:text-[var(--color-foreground)] flex items-center gap-2 transition-colors"
                }
              >
                <Icon className={`w-4 h-4 shrink-0 ${panel === k ? "text-[var(--color-brand)]" : "group-hover/hw:text-[var(--color-foreground)]"}`} />
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
          aria-label={`${HARDWARE_LABELS[panel]} hardware`}
          className="fixed w-[360px] bg-[var(--color-panel)] border-r border-[var(--color-border)] shadow-[var(--edge-top),var(--shadow-lg)] flex flex-col z-40"
          style={{
            top: anchor.top,
            bottom: 0,
            left: anchor.left,
          }}
        >
          <div className="flex items-center justify-between px-3 h-10 border-b border-[var(--color-border)] shrink-0 bg-[linear-gradient(180deg,var(--color-elevated),transparent)] shadow-[var(--edge-top)]">
            <span className="eyebrow">
              {HARDWARE_LABELS[panel]}
            </span>
            <button
              type="button"
              onClick={() => setPanel(null)}
              aria-label="Close"
              className="rounded-md p-1 text-[var(--color-muted-foreground)] transition-colors duration-200 hover:text-[var(--color-foreground)] hover:bg-white/[0.06]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto pf-transcript-scroll p-2 text-[12px]">
            {panel === "screens" && <ScreensPanel />}
            {panel === "audio" && <AudioTab />}
            {panel === "video" && <VideoInputPanel />}
          </div>
        </div>,
        document.body,
      )}
    </section>
  );
}
