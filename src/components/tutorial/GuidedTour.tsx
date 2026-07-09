"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { X, ChevronRight, ChevronLeft, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { completeTutorial, skipTutorial } from "@/lib/tutorial-actions";

/**
 * First-run guided tour. Shown ONLY when the user's tutorialCompletedAt
 * is null. Overlays a spotlight card at the bottom-right of the viewport
 * and progressively "unlocks" nav items in the order of the tour steps.
 *
 * The Sidebar reads the same `ff_tutorial_step` localStorage key and
 * greys out any nav item whose href isn't in the "reached" set.
 */

const STEPS: { key: string; title: string; body: string; href: string; unlocks: string[] }[] = [
  { key: "dashboard", title: "Your dashboard", body: "This is the overview — recent service plans and quick links. Head here first each week.", href: "/dashboard", unlocks: ["/dashboard"] },
  { key: "services", title: "Service plans", body: "Every Sunday starts here. Create a plan, drop in songs/scripture/media, then hit Operate.", href: "/services", unlocks: ["/dashboard", "/services"] },
  { key: "songs", title: "Songs library", body: "Your public-domain hymns plus anything imported from ProPresenter, OpenSong, etc.", href: "/library/songs", unlocks: ["/dashboard", "/services", "/library/songs"] },
  { key: "bible", title: "Bible browser", body: "Seven translations. Browse by book/chapter or search by meaning (semantic search).", href: "/library/bible", unlocks: ["/dashboard", "/services", "/library/songs", "/library/bible"] },
  { key: "media", title: "Media library", body: "Images, videos, and imported PPTX slides — all stored ready for playlist items.", href: "/library/media", unlocks: ["/dashboard", "/services", "/library/songs", "/library/bible", "/library/media"] },
  { key: "operator", title: "Operator console", body: "The Sunday-morning cockpit. Preview + Live panes are visually distinct — Approve stages to Preview only, never straight to Live.", href: "/services", unlocks: ["/dashboard", "/services", "/library/songs", "/library/bible", "/library/media"] },
  { key: "ai", title: "AI Assistant", body: "Turn on AI Listening in the operator screen. Detected Bible references + songs appear as approve-able cards.", href: "/services", unlocks: ["/dashboard", "/services", "/library/songs", "/library/bible", "/library/media", "/library/imports", "/archive"] },
  { key: "settings", title: "Settings", body: "Bible defaults, retention, wake-prefix for voice commands, and dark 'production mode' for low-light booths.", href: "/settings", unlocks: ["/dashboard", "/services", "/library/songs", "/library/bible", "/library/media", "/library/imports", "/archive", "/settings"] },
];

const STORAGE_KEY = "ff_tutorial_step";

export function GuidedTour({ onDone }: { onDone: () => void }) {
  const [stepIdx, setStepIdx] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    return Number(localStorage.getItem(STORAGE_KEY) || "0") | 0;
  });

  const step = STEPS[Math.min(stepIdx, STEPS.length - 1)];

  useEffect(() => {
    // Broadcast the unlock set for the Sidebar to consume.
    localStorage.setItem(STORAGE_KEY, String(stepIdx));
    localStorage.setItem("ff_tutorial_unlocked", JSON.stringify(step.unlocks));
    window.dispatchEvent(new Event("ff-tutorial-update"));
  }, [stepIdx, step.unlocks]);

  async function finish() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem("ff_tutorial_unlocked");
    window.dispatchEvent(new Event("ff-tutorial-update"));
    await completeTutorial();
    onDone();
    toast.success("You're all set — happy Sunday!");
  }

  async function skip() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem("ff_tutorial_unlocked");
    window.dispatchEvent(new Event("ff-tutorial-update"));
    await skipTutorial();
    onDone();
  }

  return (
    <>
      {/* Backdrop dimmer */}
      <div className="fixed inset-0 bg-black/30 z-40 pointer-events-none" />
      {/* Spotlight card */}
      <div className="fixed bottom-6 right-6 w-96 max-w-[calc(100vw-3rem)] border border-border rounded-md bg-card shadow-xl p-4 z-50">
        <div className="flex items-start justify-between mb-3 gap-3">
          <div className="flex items-center gap-2">
            <div className="size-7 rounded-md bg-foreground text-background flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Step {stepIdx + 1} of {STEPS.length}</div>
              <div className="text-sm font-semibold">{step.title}</div>
            </div>
          </div>
          <button onClick={skip} title="Skip tutorial"
            className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed mb-3">{step.body}</p>

        {/* Progress dots */}
        <div className="flex gap-1 mb-3">
          {STEPS.map((_, i) => (
            <span key={i} className={cn(
              "h-1 rounded-full transition-all",
              i < stepIdx ? "bg-success w-4" : i === stepIdx ? "bg-foreground w-6" : "bg-muted w-4"
            )} />
          ))}
        </div>

        <div className="flex items-center gap-2">
          {stepIdx > 0 && (
            <button onClick={() => setStepIdx((v) => v - 1)}
              className="h-9 px-3 border border-border rounded-md text-xs font-semibold hover:bg-accent flex items-center gap-1">
              <ChevronLeft className="w-3 h-3" /> Back
            </button>
          )}
          <Link href={step.href}
            className="h-9 px-3 border border-border rounded-md text-xs font-semibold hover:bg-accent flex items-center gap-1">
            Open {step.key}
          </Link>
          {stepIdx < STEPS.length - 1 ? (
            <button onClick={() => setStepIdx((v) => v + 1)}
              className="ml-auto h-9 px-3 bg-foreground text-background rounded-md text-xs font-semibold hover:opacity-90 flex items-center gap-1">
              Next <ChevronRight className="w-3 h-3" />
            </button>
          ) : (
            <button onClick={finish}
              className="ml-auto h-9 px-4 bg-foreground text-background rounded-md text-xs font-semibold hover:opacity-90">
              Finish
            </button>
          )}
          <button onClick={skip}
            className="text-[10px] text-muted-foreground hover:text-foreground underline whitespace-nowrap">
            Skip
          </button>
        </div>
      </div>
    </>
  );
}
