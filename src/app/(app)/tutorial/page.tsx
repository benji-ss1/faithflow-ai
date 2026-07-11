import { requireUser } from "@/lib/session";
import { GatedTutorial } from "@/components/onboarding/GatedTutorial";
import { PageHeader } from "@/components/layout/PageHeader";

/**
 * Gated 1-1 tutorial.
 *
 * Twelve channels, each unlocked only when the previous is confirmed
 * understood by the volunteer. Every channel has:
 *   - a bubble card explaining WHAT (one-liner) and WHY (2 sentences)
 *   - a "Try it" affordance (real button or opens the real feature)
 *   - a lock icon on future channels
 *   - progress bar
 *
 * Persists progress in localStorage under ff.tutorial.done keyed by
 * channel key. Users can resume across sessions.
 */
export default async function TutorialPage() {
  await requireUser();
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Help"
        title="Guided tutorial"
        description="Twelve channels. Each unlocks the next. Under 10 minutes."
      />
      <GatedTutorial />
    </div>
  );
}
