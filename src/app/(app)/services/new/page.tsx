import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { createServicePlan } from "@/lib/actions";
import { PageHeader } from "@/components/layout/PageHeader";

async function create(formData: FormData) {
  "use server";
  const res = await createServicePlan(formData);
  if (res.ok && res.data) redirect(`/services/${res.data.id}`);
  redirect("/services");
}

export default async function NewServicePage() {
  await requireUser();
  return (
    <div className="max-w-xl mx-auto py-10">
      <PageHeader eyebrow="Services" title="New service plan" />
      <form action={create} className="mt-6 space-y-4">
        <label className="block">
          <span className="text-sm font-medium">Title</span>
          <input
            name="title"
            required
            autoFocus
            placeholder="Sunday Morning"
            className="mt-1 w-full h-10 px-3 border border-border rounded-md bg-background text-sm"
          />
        </label>
        <label className="text-xs text-muted-foreground inline-flex items-center gap-2 select-none">
          <input type="checkbox" name="applySuggestion" value="1" className="h-3.5 w-3.5" />
          Suggest structure from your history
        </label>
        <div className="flex gap-2 pt-2">
          <button className="h-10 px-4 bg-foreground text-background rounded-md text-sm font-semibold hover:opacity-90">
            Create plan
          </button>
          <a href="/services" className="h-10 px-4 border border-border rounded-md text-sm font-semibold inline-flex items-center hover:bg-muted">
            Cancel
          </a>
        </div>
      </form>
    </div>
  );
}
