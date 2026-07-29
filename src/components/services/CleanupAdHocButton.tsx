"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { cleanupAdHocServicePlans } from "@/lib/actions";

export function CleanupAdHocButton({ count }: { count: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (!confirm(`Delete ${count - 1} old ad-hoc services and keep only the most recent one?`)) return;
    startTransition(async () => {
      const res = await cleanupAdHocServicePlans();
      if (!res.ok) { toast.error(res.error || "Cleanup failed"); return; }
      toast.success(`Removed ${res.data?.deleted ?? 0} ad-hoc services`);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--pf-admin-accent)] px-3 text-xs font-semibold text-[var(--pf-admin-text-inverse)] transition-colors hover:bg-[var(--pf-admin-accent-hover)] disabled:opacity-50"
    >
      <Trash2 className="h-3.5 w-3.5" />
      {pending ? "Cleaning…" : "Clean up ad-hocs"}
    </button>
  );
}
