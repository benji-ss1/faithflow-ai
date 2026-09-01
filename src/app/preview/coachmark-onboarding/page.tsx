import { PreviewCoachmark } from "@/components/preview-onboarding/PreviewCoachmark";

export const dynamic = "force-dynamic";

// DEV PREVIEW of the in-app coachmark onboarding — a guided spotlight tour that
// runs INSIDE a mock of the real operator console (Screens / Audio / AI toggle /
// magic moment). Isolated mockup; does NOT touch the live operator app.
// Reachable at /preview/coachmark-onboarding while signed in.
export default function PreviewCoachmarkPage() {
  return <PreviewCoachmark />;
}
