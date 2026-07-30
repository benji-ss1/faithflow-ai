"use client";
import { useState } from "react";
import { ChevronDown, ChevronRight, Lock } from "lucide-react";
import { toast } from "sonner";
import type { CenterMode } from "../ProOperatorShell";

// 2026-07-25 — Pro Plan lock. The "Free" tier is accessible; the premium
// categories show a lock icon and open the "coming soon" banner on click.
// The MEDIA header carries a PRO badge so the section's premium nature
// is obvious at a glance.
type Category = { name: string; locked: boolean };
const CATEGORIES: Category[] = [
  { name: "Cinematic", locked: true },
  { name: "Free", locked: false },
  { name: "Creators", locked: true },
  { name: "Intro Videos", locked: true },
];

// Change 5A (2026-07-27) — MediaSection is now the SOLE entry point to the
// Media center panel (topbar Media button was retired in Change 5B). Click
// behavior mirrors the topbar Songs/Bible pattern: clicking an unlocked
// category while media is already the active center mode toggles back to
// "slides", matching operator expectation of the toggle metaphor.
export function MediaSection({
  onCenterMode, centerMode,
}: {
  onCenterMode?: (m: CenterMode) => void;
  centerMode?: CenterMode;
}) {
  const [open, setOpen] = useState(true);
  const [showBanner, setShowBanner] = useState(false);

  const handleClick = (c: Category) => {
    if (c.locked) {
      setShowBanner(true);
      return;
    }
    // Toggle behavior — matches Songs/Bible topbar buttons.
    onCenterMode?.(centerMode === "media" ? "slides" : "media");
  };

  return (
    <section className="border-b border-[var(--color-border)]">
      <header className="flex items-center h-7 px-2 gap-1">
        <button
          type="button"
          className="flex items-center gap-1 flex-1 text-left"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <span className="eyebrow">Media</span>
          <span
            className="text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
            style={{ background: "#f97316", color: "#000" }}
            title="Premium content — Pro plan"
          >
            PRO
          </span>
        </button>
      </header>
      {open && (
        <>
          <ul className="pb-1">
            {CATEGORIES.map((c) => (
              <li key={c.name}>
                <button
                  type="button"
                  title={c.locked ? "Pro Plan — Cinematic, Creators and Intro Videos" : `Browse ${c.name}`}
                  onClick={() => handleClick(c)}
                  className={
                    c.locked
                      ? "w-full text-left px-2 py-1 text-[12px] text-[var(--color-muted-foreground)] opacity-50 hover:opacity-70 hover:bg-white/5 flex items-center gap-1.5"
                      : "w-full text-left px-2 py-1 text-[12px] text-[var(--color-muted-foreground)] hover:bg-white/5 hover:text-[var(--color-foreground)] flex items-center gap-1.5"
                  }
                >
                  {c.locked && <Lock className="w-3 h-3 shrink-0" />}
                  <span>{c.name}</span>
                </button>
              </li>
            ))}
          </ul>
          {showBanner && (
            <div
              className="mx-2 mb-2 p-2 rounded border relative"
              style={{
                background: "linear-gradient(135deg, rgba(232,116,42,0.10), rgba(155,143,232,0.10))",
                borderColor: "rgba(232,116,42,0.30)",
              }}
            >
              <div className="flex items-start gap-1.5">
                <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#f97316]" />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold text-[var(--color-foreground)]">Pro Plan feature</div>
                  <div className="text-[10px] leading-snug text-[var(--color-muted-foreground)] mt-0.5">
                    Premium motion backgrounds, cinematic loops and intro videos.
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <button
                      type="button"
                      onClick={() => toast.info("Pro plan is on the way — you're on the free beta.")}
                      className="h-5 px-2 rounded text-[9px] font-semibold uppercase tracking-wider text-white"
                      style={{ background: "#f97316" }}
                    >
                      Upgrade
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowBanner(false)}
                      className="text-[10px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
