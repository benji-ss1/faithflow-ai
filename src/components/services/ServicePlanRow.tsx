"use client";
import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2, Sparkles } from "lucide-react";
import { deleteServicePlan } from "@/lib/actions";
import { SmartFolderDialog } from "@/components/operator/pro/left/SmartFolderDialog";
import { useState } from "react";
import type { SmartRules } from "@/lib/smart-folders";

export function ServicePlanRow({
  id, title, kind = "manual", rules, rulesSummary,
}: {
  id: string;
  title: string;
  /** 'smart' plans are rule-derived and read-only. */
  kind?: "manual" | "smart";
  rules?: SmartRules;
  rulesSummary?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const isSmart = kind === "smart";

  function onDelete() {
    if (!confirm(isSmart
      ? `Delete the smart playlist "${title}"? Your songs are NOT affected — a smart playlist only holds rules.`
      : `Delete "${title}"? This removes the plan and its items — cannot be undone.`)) return;
    startTransition(async () => {
      const res = await deleteServicePlan(id);
      if (!res.ok) { toast.error(res.error || "Could not delete"); return; }
      toast.success("Service deleted");
      router.refresh();
    });
  }

  return (
    <li className="p-4 flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <Link href={`/services/${id}`} className="flex items-center gap-1.5 truncate font-medium hover:underline">
          {isSmart && <Sparkles className="h-3.5 w-3.5 shrink-0 text-[var(--color-brand,#F2712E)]" aria-label="Smart playlist" />}
          <span className="truncate">{title}</span>
        </Link>
        {isSmart && rulesSummary ? (
          <div className="mt-0.5 truncate text-xs text-muted-foreground" title={rulesSummary}>
            Fills automatically — {rulesSummary}
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {isSmart ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs px-3 h-8 inline-flex items-center border border-border rounded-md hover:bg-accent"
          >
            Edit rules
          </button>
        ) : (
          <Link href={`/services/${id}`} className="text-xs px-3 h-8 inline-flex items-center border border-border rounded-md hover:bg-accent">Edit</Link>
        )}
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
      {editing && (
        <SmartFolderDialog
          open
          onOpenChange={(v) => { if (!v) setEditing(false); }}
          target="songs"
          mode="playlist"
          editing={{ id, name: title, rules: rules ?? { match: "all", rules: [] } }}
          onSaved={() => { setEditing(false); router.refresh(); }}
        />
      )}
    </li>
  );
}
