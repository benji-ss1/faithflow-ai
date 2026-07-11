import { PageHeader } from "@/components/layout/PageHeader";
import { listActivePairs } from "@/lib/device-pair-actions";
import { DevicesList } from "@/components/settings/DevicesList";

export const dynamic = "force-dynamic";

export default async function DevicesSettingsPage() {
  const res = await listActivePairs();
  const pairs = res.ok ? res.data : [];
  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="Settings"
        title="Devices"
        description="Active pair codes for networked projectors, stage displays, and livestream outputs. Codes expire 6 hours after mint. Revoke any code to instantly cut its device off from the sync stream."
      />
      <DevicesList initial={pairs} />
    </div>
  );
}
