import { requireUser } from "@/lib/session";
import { mintDeviceLinkToken } from "@/lib/device-link-actions";
import { PageHeader } from "@/components/layout/PageHeader";
import { DesktopDownloadPanel } from "@/components/settings/DesktopDownloadPanel";

export const dynamic = "force-dynamic";

/**
 * Always-available download entry point — the onboarding version
 * (src/app/onboarding/download) only appears once, right after signup. A
 * teammate who skipped it, or is setting up a second machine, had no way
 * back to the dmg links or the Gatekeeper instructions without asking
 * someone. Same shared panel, same fresh single-use device-link token.
 */
export default async function DesktopDownloadSettingsPage() {
  await requireUser();
  const link = await mintDeviceLinkToken();
  const deepLinkHref = link.ok ? `presentflow://auth?token=${encodeURIComponent(link.token)}` : null;
  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="Settings"
        title="Desktop app"
        description="Present Flow's live-show tool — projector output, AI listening, and the Bible/song panel all run here. Download it to any church computer that will run a live service."
      />
      <DesktopDownloadPanel deepLinkHref={deepLinkHref} showSkipLink={false} />
    </div>
  );
}
