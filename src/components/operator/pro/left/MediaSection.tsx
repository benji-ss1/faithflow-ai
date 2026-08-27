"use client";
import { useState } from "react";
import { ChevronDown, ChevronRight, Lock } from "lucide-react";
import { RibbonMarquee } from "../RibbonMarquee";
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

  const handleClick = (c: Category) => {
    if (c.locked) {
      toast.info("Pro plan is on the way — you're on the free beta.");
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
            className="text-[9px] font-mono font-bold uppercase tracking-[0.12em] px-1.5 py-[3px] rounded-md shadow-[var(--edge-top),var(--shadow-ember)]"
            style={{ background: "linear-gradient(180deg,#F2712E,#E8501A)", color: "#17130c" }}
            title="Premium content — Pro plan"
          >
            PRO
          </span>
        </button>
      </header>
      {/* Permanent Pro ribbon strip — sits directly under the Media header. */}
      <div className="px-2 pb-1.5">
        <RibbonMarquee variant="single" text="PRO PLAN" opacity={0.92} />
      </div>
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
                      ? "group/mc w-full text-left px-2 py-1.5 rounded-md text-[12.5px] font-medium text-[var(--color-muted-foreground)]/70 hover:text-[var(--color-muted-foreground)] hover:bg-white/[0.04] flex items-center gap-2 transition-colors"
                      : "group/mc w-full text-left px-2 py-1.5 rounded-md text-[12.5px] font-semibold text-[var(--color-foreground)] hover:bg-white/[0.05] flex items-center gap-2 transition-colors"
                  }
                >
                  <span>{c.name}</span>
                  {c.locked
                    ? <Lock className="ml-auto w-3 h-3 shrink-0 opacity-60" />
                    : <span className="ml-auto text-[8.5px] font-mono font-bold uppercase tracking-[0.1em] px-1.5 py-[2px] rounded-full bg-[#4fd18b]/16 text-[#5fd89a]">Free</span>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
