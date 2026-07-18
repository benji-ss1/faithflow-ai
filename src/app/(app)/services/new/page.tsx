import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { createServicePlan } from "@/lib/actions";
import { PageHeader } from "@/components/layout/PageHeader";

async function create(formData: FormData) {
  "use server";
  const res = await createServicePlan(formData);
  if (res.ok && res.data) redirect(`/services/${res.data.id}`);
  // Surface the failure reason via query param instead of silently
  // bouncing back to /services with no explanation.
  const err = !res.ok ? res.error : "Create failed";
  redirect(`/services/new?err=${encodeURIComponent(err)}`);
}

export default async function NewServicePage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  await requireUser();
  const { err } = await searchParams;
  return (
    <div className="max-w-xl mx-auto py-10">
      <PageHeader eyebrow="Services" title="New service plan" />
      {err && (
        <div className="mt-4 px-3 py-2 rounded-md border border-red-500/40 bg-red-500/10 text-sm text-red-200">
          {err}
        </div>
      )}
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
