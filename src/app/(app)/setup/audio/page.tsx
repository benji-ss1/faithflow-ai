import { requireUser } from "@/lib/session";
import { AudioSetupWizard } from "@/components/setup/AudioSetupWizard";
import { PageHeader } from "@/components/layout/PageHeader";

/**
 * Audio setup wizard.
 *
 * Guides a volunteer through:
 *   1. Grant microphone permission
 *   2. Enumerate audio inputs, pick the right one
 *   3. Show live input meter — visual confirmation of audio flow
 *   4. Test recording a 3-second clip and play it back
 *   5. Save preferred device label as a preset
 *
 * Detects common mixer / USB interface names (Focusrite, PreSonus, RME, Behringer)
 * and suggests them at the top of the list.
 */
export default async function AudioSetupPage() {
  await requireUser();
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Setup"
        title="Microphone / mixer setup"
        description="Choose the audio source AI Listening will transcribe."
      />
      <AudioSetupWizard />
    </div>
  );
}
