"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { generateSermonSummaryAction } from "@/lib/actions";

export function GenerateSummaryButton({ planId }: { planId: string }) {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function go() {
    setPending(true);
    try {
      const res = await generateSermonSummaryAction(planId);
      if (!res.ok) throw new Error(res.error);
      toast.success("Summary ready");
      router.push(`/archive/${res.data!.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <button onClick={go} disabled={pending}
      className="h-9 px-4 border border-border rounded-md text-sm font-semibold hover:bg-accent inline-flex items-center gap-1.5 disabled:opacity-50">
      <Sparkles className="w-4 h-4" /> {pending ? "Summarizing…" : "Generate summary"}
    </button>
  );
}
