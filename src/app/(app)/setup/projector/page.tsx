import { requireUser } from "@/lib/session";
import { ProjectorSetupWizard } from "@/components/setup/ProjectorSetupWizard";
import { PageHeader } from "@/components/layout/PageHeader";

/**
 * Projector setup wizard.
 *
 * Guides a volunteer through:
 *   1. Extended display detection (Screen API + count check)
 *   2. Open /live in a new browser window
 *   3. Drag it to the projector display
 *   4. Confirm the test pattern is visible on the projector
 *   5. F for fullscreen (or double-click)
 *   6. Save preferred display index as a device pref for next Sunday
 */
export default async function ProjectorSetupPage() {
  await requireUser();
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Setup"
        title="Projector setup"
        description="One-time setup per venue. Takes about 90 seconds."
      />
      <ProjectorSetupWizard />
    </div>
  );
}
