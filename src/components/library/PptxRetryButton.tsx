"use client";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

export function PptxRetryButton({ importId }: { importId: string }) {
  const [pending, setPending] = useState(false);

  async function retry() {
    setPending(true);
    try {
      const res = await fetch("/api/pptx/convert", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ importId }),
      }).then((r) => r.json());
      if (!res.ok) throw new Error(res.error || "Retry failed");
      toast.success("Converted");
      location.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Retry failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <button onClick={retry} disabled={pending}
      className="inline-flex items-center gap-1 h-7 px-2 border border-border rounded-sm text-[11px] font-semibold hover:bg-accent disabled:opacity-50">
      <RefreshCw className={`w-3 h-3 ${pending ? "animate-spin" : ""}`} /> {pending ? "Retrying…" : "Retry"}
    </button>
  );
}
