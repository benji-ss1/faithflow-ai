import { PreviewOnboarding } from "@/components/preview-onboarding/PreviewOnboarding";

export const dynamic = "force-dynamic";

// DEV PREVIEW of the new "get your church ready for Sunday" onboarding flow.
// Separate from the live /onboarding wizard — for Benji to test the feel and
// approve before we switch it in. Reachable at /preview/onboarding while
// signed in.
export default function PreviewOnboardingPage() {
  return <PreviewOnboarding />;
}
