"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deletePptxImport } from "@/lib/actions";

export function PptxDeleteButton({ importId, fileName }: { importId: string; fileName: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (!confirm(`Delete import "${fileName}" and its converted slides? This can't be undone.`)) return;
    startTransition(async () => {
      const res = await deletePptxImport(importId);
      if (!res.ok) { toast.error(res.error || "Delete failed"); return; }
      toast.success("Import deleted");
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      title="Delete import"
      aria-label="Delete import"
      className="grid h-7 w-7 place-items-center rounded-sm text-muted-foreground hover:bg-red-500/10 hover:text-red-500 disabled:opacity-40"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}
