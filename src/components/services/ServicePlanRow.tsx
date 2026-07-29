"use client";
import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { deleteServicePlan } from "@/lib/actions";

export function ServicePlanRow({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onDelete() {
    if (!confirm(`Delete "${title}"? This removes the plan and its items — cannot be undone.`)) return;
    startTransition(async () => {
      const res = await deleteServicePlan(id);
      if (!res.ok) { toast.error(res.error || "Could not delete"); return; }
      toast.success("Service deleted");
      router.refresh();
    });
  }

  return (
    <li className="p-4 flex items-center justify-between gap-3">
      <Link href={`/services/${id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
        {title}
      </Link>
      <div className="flex items-center gap-2 shrink-0">
        <Link href={`/services/${id}`} className="text-xs px-3 h-8 inline-flex items-center border border-border rounded-md hover:bg-accent">Edit</Link>
        <Link href={`/services/${id}/operate`} className="text-xs px-3 h-8 inline-flex items-center bg-foreground text-background rounded-md hover:opacity-90 font-semibold">Operate</Link>
        <button
          type="button"
          onClick={onDelete}
          disabled={pending}
          title="Delete service"
          aria-label="Delete service"
          className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-40"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}
