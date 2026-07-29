"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MoreVertical, Download, Pencil, Trash2 } from "lucide-react";
import { deleteMediaAsset, renameMediaAsset } from "@/lib/actions";

type Item = { id: string; kind: string; fileName: string; url: string };

export function MediaCard({ item }: { item: Item }) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(item.fileName);
  const [pending, startTransition] = useTransition();

  function onDelete() {
    if (!confirm(`Delete "${item.fileName}"? This can't be undone.`)) return;
    setMenuOpen(false);
    startTransition(async () => {
      const res = await deleteMediaAsset(item.id);
      if (!res.ok) { toast.error(res.error || "Delete failed"); return; }
      toast.success("Media deleted");
      router.refresh();
    });
  }

  function onRenameSave() {
    if (name.trim() === item.fileName) { setRenaming(false); return; }
    startTransition(async () => {
      const res = await renameMediaAsset(item.id, name);
      if (!res.ok) { toast.error(res.error || "Rename failed"); return; }
      toast.success("Renamed");
      setRenaming(false);
      router.refresh();
    });
  }

  return (
    <li className="relative border border-border rounded-md overflow-hidden bg-card group">
      <div className="aspect-video bg-black flex items-center justify-center">
        {item.kind === "image"
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={item.url} alt="" className="w-full h-full object-contain" />
          : <video src={item.url} className="w-full h-full object-contain" muted />}
      </div>
      <div className="p-3 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="eyebrow text-muted-foreground">{item.kind}</div>
          {renaming ? (
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onRenameSave();
                if (e.key === "Escape") { setName(item.fileName); setRenaming(false); }
              }}
              onBlur={onRenameSave}
              disabled={pending}
              className="mt-0.5 h-7 w-full rounded border border-border bg-background px-2 text-sm outline-none focus:border-[var(--pf-admin-accent)]"
            />
          ) : (
            <div className="text-sm font-medium truncate" title={item.fileName}>{item.fileName}</div>
          )}
        </div>
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Media actions"
            className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
          {menuOpen ? (
            <div
              className="absolute right-0 top-8 z-10 w-40 overflow-hidden rounded-md border border-border bg-popover shadow-lg"
              onMouseLeave={() => setMenuOpen(false)}
            >
              <a
                href={item.url}
                download={item.fileName}
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
              >
                <Download className="h-3.5 w-3.5" /> Download
              </a>
              <button
                type="button"
                onClick={() => { setRenaming(true); setMenuOpen(false); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
              >
                <Pencil className="h-3.5 w-3.5" /> Rename
              </button>
              <button
                type="button"
                onClick={onDelete}
                disabled={pending}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-500 hover:bg-red-500/10 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}
