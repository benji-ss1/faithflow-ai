"use client";
import { useEffect, useState } from "react";
import { Check, X, Bot, Pencil, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SuggestionHistoryRow } from "@/lib/server/services";

export function SuggestionHistory({ planId, refreshKey = 0 }: { planId: string; refreshKey?: number }) {
  const [rows, setRows] = useState<SuggestionHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/autopilot/history?planId=${encodeURIComponent(planId)}`)
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setRows(data.rows || []); })
      .catch(() => { /* ignore */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [planId, refreshKey]);

  if (loading && rows.length === 0) {
    return <div className="text-[10px] text-[color:var(--color-muted-foreground)] px-3 py-2">Loading autopilot history…</div>;
  }
  if (rows.length === 0) {
    return <div className="text-[10px] text-[color:var(--color-muted-foreground)] px-3 py-2">No suggestions yet this service.</div>;
  }

  return (
    <div className="flex gap-1.5 overflow-x-auto px-3 py-2">
      {rows.map((r) => (
        <div key={r.id} title={r.reason || ""}
          className={cn(
            "shrink-0 px-2 py-1 rounded-sm border text-[10px] font-mono inline-flex items-center gap-1.5 whitespace-nowrap",
            r.actionTaken === "auto_approved" && "border-warning/50 bg-warning/10 text-warning",
            r.actionTaken === "manual_approved" && "border-success/50 bg-success/10 text-success",
            r.actionTaken === "rejected" && "border-destructive/40 bg-destructive/10 text-destructive",
            r.actionTaken === "edited" && "border-brand/50 bg-brand/10 text-brand",
            !r.actionTaken && "border-border text-[color:var(--color-muted-foreground)]",
          )}>
          <Icon action={r.actionTaken} />
          <span className="uppercase tracking-wider">{r.type}</span>
          <span className="opacity-70">{r.confidence}%</span>
          <span className="opacity-70">{describe(r)}</span>
        </div>
      ))}
    </div>
  );
}

function Icon({ action }: { action: SuggestionHistoryRow["actionTaken"] }) {
  if (action === "auto_approved") return <Bot className="w-3 h-3" strokeWidth={2} />;
  if (action === "manual_approved") return <Check className="w-3 h-3" strokeWidth={2} />;
  if (action === "rejected") return <X className="w-3 h-3" strokeWidth={2} />;
  if (action === "edited") return <Pencil className="w-3 h-3" strokeWidth={2} />;
  return <AlertCircle className="w-3 h-3" strokeWidth={2} />;
}

function describe(r: SuggestionHistoryRow): string {
  const p = (r.editedPayload || r.payload) as Record<string, unknown>;
  if (r.type === "scripture") {
    const book = p.book ?? "?"; const c = p.chapter ?? "?"; const vs = p.verseStart ?? "?"; const ve = p.verseEnd;
    return `${book} ${c}:${vs}${ve && ve !== vs ? `-${ve}` : ""}`;
  }
  if (r.type === "song") return String(p.title || "song");
  if (r.type === "action") return String(p.verb || "action");
  return "";
}
