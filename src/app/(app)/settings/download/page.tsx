import { requireUser } from "@/lib/session";
import { PageHeader } from "@/components/layout/PageHeader";
import { DesktopDownloadPanel } from "@/components/settings/DesktopDownloadPanel";

export const dynamic = "force-dynamic";

/**
 * Always-available download entry point — the onboarding version
 * (src/app/onboarding/download) only appears once, right after signup. A
 * teammate who skipped it, or is setting up a second machine, had no way
 * back to the dmg links or the Gatekeeper instructions without asking
 * someone. Same shared panel, same on-click single-use device-link token.
 */
export default async function DesktopDownloadSettingsPage() {
  await requireUser();
  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="Settings"
        title="Desktop app"
        description="Present Flow's live-show tool — projector output, AI listening, and the Bible/song panel all run here. Download it to any church computer that will run a live service."
      />
      <DesktopDownloadPanel showSkipLink={false} />
    </div>
  );
}
