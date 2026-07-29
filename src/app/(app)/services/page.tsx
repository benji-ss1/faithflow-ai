import Link from "next/link";
import { requireUser } from "@/lib/session";
import { listServicePlans } from "@/lib/server/services";
import { PageHeader } from "@/components/layout/PageHeader";
import { ServicePlanRow } from "@/components/services/ServicePlanRow";
import { CleanupAdHocButton } from "@/components/services/CleanupAdHocButton";
import { createServicePlan } from "@/lib/actions";
import { redirect } from "next/navigation";

async function create(formData: FormData) {
  "use server";
  const res = await createServicePlan(formData);
  if (res.ok && res.data) redirect(`/services/${res.data.id}`);
}

export default async function ServicesPage() {
  const user = await requireUser();
  const plans = await listServicePlans(user.churchId);
  const adHocCount = plans.filter((p) => p.title === "Ad-hoc service").length;

  return (
    <div>
      <PageHeader eyebrow="Services" title="Service plans" />
      <form action={create} className="flex flex-wrap gap-2 mb-6 items-center">
        <input name="title" placeholder="New service title (e.g. Sunday Morning)" required
          className="flex-1 max-w-md h-9 px-3 border border-border rounded-md bg-background text-sm" />
        <label className="text-xs text-muted-foreground inline-flex items-center gap-1.5 select-none">
          <input type="checkbox" name="applySuggestion" value="1" className="h-3.5 w-3.5" />
          Suggest structure from your history
        </label>
        <button className="h-9 px-4 bg-foreground text-background rounded-md text-sm font-semibold hover:opacity-90">Create</button>
      </form>

      {adHocCount > 1 ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--pf-admin-border)] bg-[var(--pf-admin-bg-accent)] p-3">
          <div className="text-xs text-[var(--pf-admin-text-secondary)]">
            You have <span className="font-semibold text-[var(--pf-admin-text)]">{adHocCount}</span> ad-hoc services from prior operator sessions. Clean up to keep only the most recent one.
          </div>
          <CleanupAdHocButton count={adHocCount} />
        </div>
      ) : null}

      {plans.length === 0 ? (
        <div className="text-sm text-muted-foreground">No plans yet.</div>
      ) : (
        <ul className="divide-y divide-border border border-border rounded-md">
          {plans.map((p) => (
            <ServicePlanRow key={p.id} id={p.id} title={p.title} />
          ))}
        </ul>
      )}
    </div>
  );
}
