"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, ChevronLeft, Sparkles, CalendarPlus, Music, MonitorPlay, Ear, PartyPopper } from "lucide-react";
import { cn } from "@/lib/utils";
import { completeOnboarding, skipOnboarding } from "@/lib/onboarding-actions";
import { completeTutorial } from "@/lib/tutorial-actions";

// CP5: five-step progressive tutorial overlay. Uses the center-card + backdrop
// pattern common across SPA onboardings. Persists advancement in-memory only
// (users can re-open individual pages themselves once dismissed); completion
// writes tutorial_completed_at + onboardingStatus.
const STEPS = [
  {
    key: "service",
    title: "Create your first service",
    body: "Every Sunday starts with a service plan — songs, scripture, sermon slides in the order you'll run them.",
    cta: "Open Services",
    href: "/services",
    Icon: CalendarPlus,
  },
  {
    key: "song",
    title: "Add a song",
    body: "Add a song from your library, or paste lyrics right in. FaithFlow slices them into slides automatically.",
    cta: "Open Songs library",
    href: "/library/songs",
    Icon: Music,
  },
  {
    key: "operate",
    title: "Open the operator",
    body: "This is your Sunday-morning cockpit — Preview + Live panes so you never accidentally cut to a stray slide.",
    cta: "Open a plan (new tab)",
    href: "/services",
    newTab: true,
    Icon: MonitorPlay,
  },
  {
    key: "ai",
    title: "Try AI Listening",
    body: "Inside the operator, open the right inspector → AI tab. Turn on Listening and speak a Bible reference — it'll appear as an approve-able card.",
    cta: "Services",
    href: "/services",
    Icon: Ear,
  },
  {
    key: "done",
    title: "You’re ready",
    body: "That’s it. Head to the dashboard to plan your first real service.",
    cta: "Go to dashboard",
    href: "/dashboard",
    Icon: PartyPopper,
  },
] as const;

export function OnboardingTutorialClient() {
  const router = useRouter();
  const [stepIdx, setStepIdx] = useState(0);
  const [pending, startTransition] = useTransition();
  const step = STEPS[stepIdx];
  const isLast = stepIdx === STEPS.length - 1;

  function skip() {
    startTransition(async () => {
      await Promise.all([completeTutorial(), skipOnboarding()]);
      router.push("/dashboard");
    });
  }

  function finish() {
    startTransition(async () => {
      await Promise.all([completeTutorial(), completeOnboarding()]);
      router.push("/dashboard");
    });
  }

  function next() {
    if (isLast) { finish(); return; }
    setStepIdx((v) => v + 1);
  }

  function openCta() {
    if ("newTab" in step && step.newTab) {
      window.open(step.href, "_blank", "noopener");
    } else {
      window.open(step.href, "_blank", "noopener");
    }
  }

  return (
    <>
      {/* Backdrop dimmer */}
      <div className="fixed inset-0 bg-black/40 z-40 pointer-events-none" />
      {/* Center card */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-6 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-lg border border-border rounded-lg bg-card shadow-2xl p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-md bg-foreground text-background flex items-center justify-center">
                <step.Icon className="w-5 h-5" />
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Step {stepIdx + 1} of {STEPS.length}</div>
                <div className="text-base font-semibold">{step.title}</div>
              </div>
            </div>
            <Sparkles className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
          </div>

          <p className="text-sm text-muted-foreground leading-relaxed">{step.body}</p>

          {/* Progress dots */}
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <span key={i} className={cn(
                "h-1.5 rounded-full transition-all",
                i < stepIdx ? "bg-success w-6" : i === stepIdx ? "bg-foreground w-8" : "bg-muted w-6"
              )} />
            ))}
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-border">
            <button onClick={skip} disabled={pending}
              className="text-xs text-muted-foreground hover:text-foreground underline">
              Skip tutorial
            </button>
            <div className="ml-auto flex items-center gap-2">
              {stepIdx > 0 && (
                <button onClick={() => setStepIdx((v) => v - 1)}
                  className="h-9 px-3 border border-border rounded-md text-xs font-semibold hover:bg-accent flex items-center gap-1">
                  <ChevronLeft className="w-3 h-3" /> Back
                </button>
              )}
              {!isLast && (
                <button onClick={openCta}
                  className="h-9 px-3 border border-border rounded-md text-xs font-semibold hover:bg-accent">
                  {step.cta}
                </button>
              )}
              <button onClick={next} disabled={pending}
                className="h-9 px-4 bg-foreground text-background rounded-md text-xs font-semibold hover:opacity-90 disabled:opacity-50 flex items-center gap-1">
                {isLast ? (pending ? "Finishing…" : "Finish") : (<>Next <ChevronRight className="w-3 h-3" /></>)}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
