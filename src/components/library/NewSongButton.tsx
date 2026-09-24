"use client";
/**
 * Library → Songs "New song…" button: opens the SAME PP7-style New Presentation
 * dialog the operator uses (NewSongDialog), then opens the new song. The page's
 * existing quick-create form stays as-is (never regress).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { NewSongDialog } from "@/components/operator/pro/center/NewSongDialog";
import { useConfirm } from "@/components/ui/ConfirmDialog";

export function NewSongButton({ existingTitles }: { existingTitles: string[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { confirm, dialog: confirmDialog } = useConfirm();
  return (
    <>
      {confirmDialog}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 items-center gap-1 rounded-xl border border-border px-4 text-sm font-semibold hover:bg-muted"
      >
        <Plus className="h-4 w-4" /> New song…
      </button>
      <NewSongDialog
        open={open}
        onOpenChange={setOpen}
        existingTitles={existingTitles}
        confirmDuplicate={(t) => confirm({ title: `"${t}" already exists`, description: "A song with this title is already in your library. Create another anyway?", confirmLabel: "Create another" })}
        onCreated={(row) => router.push(`/library/songs/${row.id}`)}
      />
    </>
  );
}
