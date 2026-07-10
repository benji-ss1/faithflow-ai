import { PageHeader } from "@/components/layout/PageHeader";
import { requireUser } from "@/lib/session";
import { getPresets } from "./presets";
import PracticeConsole from "./PracticeConsole";

export const dynamic = "force-dynamic";

export default async function PracticePage() {
  const user = await requireUser();
  const presets = getPresets();
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sandbox"
        title="Practice Mode"
        description="Rehearse the operator flow against a scripted transcript. Nothing here reaches the projector or persists."
      />
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-200">
        PRACTICE MODE — nothing here goes to the projector or persists. All actions stay in your browser.
      </div>
      <PracticeConsole churchId={user.churchId} presets={presets} />
    </div>
  );
}
