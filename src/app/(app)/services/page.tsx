import Link from "next/link";
import { requireUser } from "@/lib/session";
import { listServicePlans } from "@/lib/server/services";
import { PageHeader } from "@/components/layout/PageHeader";
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
  return (
    <div>
      <PageHeader eyebrow="Services" title="Service plans" />
      <form action={create} className="flex gap-2 mb-6">
        <input name="title" placeholder="New service title (e.g. Sunday Morning)" required
          className="flex-1 max-w-md h-9 px-3 border border-border rounded-md bg-background text-sm" />
        <button className="h-9 px-4 bg-foreground text-background rounded-md text-sm font-semibold hover:opacity-90">Create</button>
      </form>
      {plans.length === 0 ? (
        <div className="text-sm text-muted-foreground">No plans yet.</div>
      ) : (
        <ul className="divide-y divide-border border border-border rounded-md">
          {plans.map((p) => (
            <li key={p.id} className="p-4 flex items-center justify-between">
              <Link href={`/services/${p.id}`} className="font-medium hover:underline">{p.title}</Link>
              <div className="flex gap-2">
                <Link href={`/services/${p.id}`} className="text-xs px-3 h-8 inline-flex items-center border border-border rounded-md hover:bg-accent">Edit</Link>
                <Link href={`/services/${p.id}/operate`} className="text-xs px-3 h-8 inline-flex items-center bg-foreground text-background rounded-md hover:opacity-90 font-semibold">Operate</Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
