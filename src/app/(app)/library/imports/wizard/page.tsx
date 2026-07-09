import { requireUser } from "@/lib/session";
import { PageHeader } from "@/components/layout/PageHeader";
import { WizardClient } from "./WizardClient";

export default async function ImportWizardPage() {
  await requireUser();
  return (
    <div>
      <PageHeader
        eyebrow="Library"
        title="Import Wizard"
        description="Switch over from another worship presentation platform. We'll parse your files server-side, show you a preview, and only touch your library when you confirm."
      />
      <WizardClient />
    </div>
  );
}
