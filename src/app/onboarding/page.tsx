import { redirect } from "next/navigation";
import { requirePartialUser } from "@/lib/session";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";

export default async function OnboardingPage() {
  const partial = await requirePartialUser();
  // If church already set + onboarding complete, kick to dashboard.
  if (partial.churchId) {
    // A user that comes back here after finishing gets their dashboard.
    // (We don't hard-block reopening — they might want to re-run migration.)
  }
  return <OnboardingWizard
    userName={partial.name}
    userEmail={partial.email}
    hasChurch={!!partial.churchId}
    emailVerified={partial.emailVerified}
  />;
}
