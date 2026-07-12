import { PageHeader } from "@/components/layout/PageHeader";
import { AccountCard } from "@/components/account/AccountCard";

export default function NewServicePage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Services"
        title="Create a service plan"
        description="A dedicated service-plan builder is coming in the next build. For now, use the Services list to open an existing plan or start one from a template."
      />
      <AccountCard title="Coming soon" description="This surface will let admins compose a full order-of-service (opening prayer, worship set, scripture, sermon, response) with drag-and-drop, then hand it off to the desktop operator for live play. Until then, service plans are created inline from the desktop app when a plan is opened.">
        <div className="inline-flex rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-muted-foreground">
          In build
        </div>
      </AccountCard>
    </div>
  );
}
