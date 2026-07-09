"use client";
import { useTransition } from "react";
import { toast } from "sonner";
import { Archive } from "lucide-react";
import { scaffoldSermonArchive } from "@/lib/actions";

export function EndServiceButton({ planId, hasTranscript }: { planId: string; hasTranscript: boolean }) {
  const [pending, start] = useTransition();
  const onClick = () => {
    if (!confirm("End the service and archive it now? This is safe to click multiple times.")) return;
    start(async () => {
      const res = await scaffoldSermonArchive(planId);
      if (res.ok) toast.success("Service archived. Visit /archive to view.");
      else toast.error(res.error);
    });
  };
  return (
    <button onClick={onClick} disabled={pending || !hasTranscript}
      title={hasTranscript ? "Archive this service" : "Waiting for transcript segments"}
      className="inline-flex items-center gap-1.5 h-8 px-3 border border-border rounded-md text-xs font-semibold hover:bg-accent disabled:opacity-40">
      <Archive className="w-3.5 h-3.5" /> {pending ? "Archiving…" : "End service & archive"}
    </button>
  );
}
