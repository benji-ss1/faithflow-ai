import { PreviewDesktop } from "@/components/preview-onboarding/PreviewDesktop";

export const dynamic = "force-dynamic";

// DEV PREVIEW of the DESKTOP-app onboarding flow — "get your church ready for
// Sunday" with the hardware steps (screens + mixer + the magic moment) that only
// make sense on the church computer. Isolated mockup; does NOT touch the real
// desktop app. Reachable at /preview/desktop-onboarding while signed in.
export default function PreviewDesktopPage() {
  return <PreviewDesktop />;
}
