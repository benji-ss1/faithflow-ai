import { requireUser } from "@/lib/session";
import { AudioSetupWizard } from "@/components/setup/AudioSetupWizard";
import { SarahSetupWizard } from "@/components/setup/sarah/SarahSetupWizard";
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
 *
 * Audio Lock-In (2026-09-15): the Sarah AI-guided wizard replaces this when
 * NEXT_PUBLIC_AUDIO_LOCKIN=1 or ?sarah=1. The legacy wizard stays the default
 * until Sarah is field-verified.
 */
export default async function AudioSetupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const sarah = process.env.NEXT_PUBLIC_AUDIO_LOCKIN === "1" ? sp.sarah !== "0" : sp.sarah === "1";
  if (sarah) return <SarahSetupWizard />;
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
