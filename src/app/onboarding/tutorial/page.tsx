import { redirect } from "next/navigation";
import { requirePartialUser } from "@/lib/session";
import { OnboardingTutorialClient } from "@/components/onboarding/OnboardingTutorialClient";

// CP5: progressive-unlock tutorial (5 steps, center-card + backdrop pattern).
// Completing OR skipping the tutorial sets churches.onboardingStatus to
// "complete" / "skipped" and stamps users.tutorial_completed_at.
export default async function OnboardingTutorialPage() {
  const partial = await requirePartialUser();
  if (!partial.churchId) redirect("/onboarding/church");

  return (
    <div className="min-h-screen bg-background flex items-start justify-center py-10 px-6">
      <div className="w-full max-w-2xl space-y-6">
        <div>
          <div className="eyebrow text-muted-foreground mb-1">Step 3 of 3 · Getting set up</div>
          <h1 className="text-2xl md:text-3xl font-semibold font-display">Take the quick tour</h1>
          <p className="text-sm text-muted-foreground mt-1">Five minutes. Then you&apos;re running your first service plan.</p>
        </div>
        <OnboardingTutorialClient />
      </div>
    </div>
  );
}
